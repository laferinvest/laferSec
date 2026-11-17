import argparse
import hashlib
import json
import re
from pathlib import Path

import yaml


def sections(text, level=2):
    parts = re.split(rf"(?m)^{ '#' * level } (.+)\n", text)
    return [(title.strip(), body.strip()) for title, body in zip(parts[1::2], parts[2::2])]


def references(text, pattern):
    return list(dict.fromkeys(re.findall(pattern, text)))


def load_run(root):
    files = {}

    def read(relative):
        path = (root / relative).resolve()
        path.relative_to(root)
        if relative not in files:
            files[relative] = path.read_bytes()
        return files[relative].decode("utf-8-sig").replace("\r\n", "\n")

    reports = sorted((root / "02-execucoes/relatorios").glob("????-??-??.md"))
    if not reports:
        raise ValueError("Nenhum relatório datado encontrado.")
    date = reports[-1].stem
    report_path = f"02-execucoes/relatorios/{date}.md"
    report = read(report_path)
    run_id, revision = re.search(
        r"\*\*Execução\*\* `(EXEC-[\w-]+)`[^\n]*\*\*Revisão\*\* `(EXEC-[\w-]+)`", report
    ).groups()
    if not re.fullmatch(re.escape(run_id) + r"-R\d+", revision):
        raise ValueError("A revisão do relatório pertence a outra execução.")
    period = re.search(r"\*\*Período\*\* (.+)", report)[1].strip()
    news_path = f"02-execucoes/noticias/{date}.md"
    news_text = read(news_path)
    log_path = f"02-execucoes/logs/{date}.md"
    log = read(log_path)
    queue_path = "02-execucoes/pendencias.md"
    queue = read(queue_path)
    if any(f"`{run_id}`" not in document for document in (news_text, log, queue)):
        raise ValueError("Triagem, log ou pendências pertencem a outra execução.")

    news_sections = dict(sections(news_text))
    sources = {}
    for row in news_sections["Fontes"].splitlines():
        if not re.match(r"^\| F\d+ \|", row):
            continue
        source_id, link, publisher, date_pub, consulted, group, access, role = (
            cell.strip() for cell in row.strip("|").split("|")
        )
        title, url = re.fullmatch(r"\[(.+)\]\((https?://[^\s]+)\)", link).groups()
        if source_id in sources or access not in ("conteudo_consultado", "apenas_resumo", "inacessivel"):
            raise ValueError(f"Fonte inválida ou duplicada: {source_id}")
        sources[source_id] = dict(id=source_id, title=title, url=url, publisher=publisher,
                                  published=None if date_pub == "null" else date_pub,
                                  consulted=consulted, group=group, access=access, role=role)

    news = []
    for heading, body in news_sections.items():
        match = re.fullmatch(r"(NOT-\d+-\d+) — (.+)", heading)
        if not match:
            continue
        news_id, title = match.groups()
        decision = re.search(r"(?m)^- \*\*Destino\*\* (.+)$", body)[1]
        impact = re.search(r"(?m)^- \*\*Impacto [^*]+\*\* (.+)$", body)[1]
        evidence_details = dict(re.findall(r"(?m)^- \*\*(E\d+)\*\*\. (.+)$", body))
        claims = []
        for claim_id, classification, claim_text in re.findall(r"(?m)^- \*\*(A\d+) · ([^*]+)\*\*\. (.+)$", body):
            evidence = []
            for evidence_id, source_id, location in re.findall(r"\[(E\d+) → (F\d+)(?:, ([^\]]+))?\]", claim_text):
                if sources[source_id]["access"] != "conteudo_consultado":
                    raise ValueError(f"{news_id}: evidência aponta para fonte sem conteúdo consultado.")
                detail = evidence_details.get(evidence_id) or location
                if not detail:
                    raise ValueError(f"{news_id}: localização ausente para {evidence_id}.")
                evidence.append(dict(id=evidence_id, sourceId=source_id, detail=detail))
            if not evidence:
                raise ValueError(f"{news_id}: referência de evidência não reconhecida em {claim_id}.")
            claims.append(dict(id=claim_id, classification=classification, text=claim_text, evidence=evidence))
        if not claims:
            raise ValueError(f"{news_id}: nenhuma afirmação encontrada.")
        source_ids = references(body, r"\bF\d+\b")
        for source_id in source_ids:
            if source_id not in sources:
                raise ValueError(f"{news_id}: fonte ausente {source_id}.")
        news.append(dict(id=news_id, title=title, decision=decision, impact=impact, claims=claims,
                         sourceIds=source_ids, memoryIds=references(decision, r"\bMEM-\d+\b"),
                         verification=re.findall(r"(?m)^- \*\*Verificação adicional\*\* (.+)$", body)))

    news_by_id = {item["id"]: item for item in news}
    if not news or len(news) != len(news_by_id):
        raise ValueError("Triagem vazia ou com IDs duplicados.")
    index_path = "01-wiki/indice.md"
    index = read(index_path)
    memory_paths = dict(re.findall(r"(?m)^\| (MEM-\d+) \|[^\n]*?\[Memória\]\(([^)]+)\)", index))
    memories = []
    for memory_id in dict.fromkeys(mid for item in news for mid in item["memoryIds"]):
        path = f"01-wiki/{memory_paths[memory_id]}"
        frontmatter, body = re.fullmatch(r"---\n(.*?)\n---\n(.*)", read(path), re.S).groups()
        memory = yaml.safe_load(frontmatter)
        if memory["id"] != memory_id or not memory["ultima_revisao_id"].startswith(f"{run_id}-R"):
            raise ValueError(f"{memory_id}: arquivo não corresponde à revisão desta execução.")
        memory_sources = {source["id_fonte"]: source for source in memory["fontes"]}
        evidence = {entry["id"]: entry for entry in memory["evidencias"]}
        for claim in memory["afirmacoes"]:
            for evidence_id in claim["evidencia_ids"]:
                source = memory_sources[evidence[evidence_id]["fonte_id"]]
                if source["status_acesso"] != "conteudo_consultado":
                    raise ValueError(f"{memory_id}: evidência aponta para fonte sem conteúdo consultado.")
        origins = [item["id"] for item in news if memory_id in item["memoryIds"]]
        memories.append(dict(id=memory_id, title=memory["titulo"], kind=memory["tipo"], newsIds=origins,
                             summary=body.split("## ", 1)[0].removeprefix("\n# Resumo\n").strip(),
                             sections=sections(body), details=memory, original=path))

    summary_text = dict(sections(report))["Resumo executivo"]
    claim_news = {claim["id"]: item["id"] for item in news for claim in item["claims"]}
    summary = []
    for line in summary_text.splitlines():
        if not line.startswith("- "):
            continue
        link_match = re.search(r"\[([^\]]+)\]\(\.\./noticias/[^)]+\)\.?$", line)
        if not link_match:
            raise ValueError("Item da síntese sem referência à triagem.")
        refs = link_match[1]
        refs = re.sub(r"A(\d+)–A(\d+)", lambda m: " ".join(
            f"A{i:03}" for i in range(int(m[1]), int(m[2]) + 1)
        ), refs)
        news_ids = references(refs, r"NOT-\d+-\d+")
        news_ids.extend(claim_news[claim] for claim in references(refs, r"A\d+"))
        ids = list(dict.fromkeys(news_ids))
        if not ids or any(news_id not in news_by_id for news_id in ids):
            raise ValueError("Referência da síntese não encontrada na triagem.")
        summary.append(dict(text=line[2:link_match.start()].strip(), newsIds=ids))
    if not summary:
        raise ValueError("Resumo executivo vazio.")

    pending = []
    for title, body in sections(queue, 3):
        ids = references(body, r"NOT-\d+-\d+")
        if any(news_id not in news_by_id for news_id in ids):
            raise ValueError(f"Notícia ausente na pendência {title}.")
        pending.append(dict(title=title, body=body, newsIds=ids))

    document = dict(version=1, id=run_id, revision=revision, date=date, period=period, summary=summary,
                    news=news, sources=sources, memories=memories, pending=pending,
                    originals=[dict(path=path, sha256=hashlib.sha256(data).hexdigest())
                               for path, data in sorted(files.items())],
                    reportOriginal=report_path, logOriginal=log_path)
    return document, files


def main():
    parser = argparse.ArgumentParser(description="Prepara a última execução do laferNews para publicação.")
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        document, files = load_run(args.source.resolve())
        output = args.output.resolve()
        output.mkdir(parents=True, exist_ok=True)
        for path, data in files.items():
            destination = output / "originais" / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
        (output / "execucao.json").write_text(
            json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f'{document["revision"]}: {len(document["news"])} notícias, '
              f'{len(document["sources"])} fontes, {len(document["memories"])} memórias, '
              f'{len(document["pending"])} pendências.')
    except (AttributeError, KeyError, OSError, ValueError, yaml.YAMLError) as error:
        parser.exit(1, f"Importação interrompida: {error}\n")


if __name__ == "__main__":
    main()
