"""Cidade e UF do estabelecimento, consultadas pelo CNPJ completo."""
from __future__ import annotations

import concurrent.futures
import argparse
import hashlib
import json
import sqlite3
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from .capital_social import LOOKUP_URL
from .cvm_fidc import normalize_cnpj
from .empresas_cedentes import HEADERS, RateLimiter

UFS = set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split())


def validate_location(cnpj: str, payload: dict, url: str) -> dict:
    if normalize_cnpj(str(payload.get("cnpj", ""))) != cnpj:
        raise ValueError("cnpj_da_resposta_divergente_inclusive_filial")
    city = str(payload.get("municipio") or "").strip()
    state = str(payload.get("uf") or "").strip().upper()
    if state == "EX":
        city = str(payload.get("nome_cidade_exterior") or "").strip() or None
        status = "exterior" if city else "cidade_exterior_nao_informada"
    elif state in UFS:
        status = "ok" if city else "cidade_nao_informada"
    elif state:
        raise ValueError("uf_invalida: " + state)
    else:
        status = "uf_nao_informada"
    return {"cnpj": cnpj, "cidade": city or None, "uf": state or None,
            "razao_social_cadastro": payload.get("razao_social"),
            "status": status, "url_fonte": url, "campos_fonte": ["municipio", "uf"]}


def fetch_location(cnpj: str, cache_dir: Path, limiter: RateLimiter) -> dict:
    destination = cache_dir / (cnpj + ".json")
    if destination.exists():
        cached = json.loads(destination.read_text(encoding="utf8"))
        if cached.get("cnpj") == cnpj and cached.get("status") not in ("erro", "cadastro_nao_encontrado"):
            return cached
    url = LOOKUP_URL + cnpj
    record, error = None, None
    for attempt in range(3):
        limiter.wait()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=20) as response:
                raw = response.read()
            record = validate_location(cnpj, json.loads(raw), url)
            record["resposta_sha256"] = hashlib.sha256(raw).hexdigest()
            break
        except urllib.error.HTTPError as exc:
            error = f"HTTP {exc.code}"
            if exc.code in (401, 403, 404):
                break
            if attempt < 2:
                try:
                    delay = int(exc.headers.get("Retry-After", "0"))
                except ValueError:
                    delay = 0
                time.sleep(min(30, delay or 2 ** (attempt + 1)))
        except (ValueError, OSError) as exc:
            error = str(exc)
            if attempt < 2:
                time.sleep(2 ** (attempt + 1))
    if record is None:
        record = {"cnpj": cnpj, "cidade": None, "uf": None, "status": "erro",
                  "erro": error, "url_fonte": url}
    record["data_consulta"] = datetime.now(timezone.utc).isoformat()
    cache_dir.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".json.part")
    temporary.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf8")
    temporary.replace(destination)
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args()
    data = Path("radar_cedentes/data")
    companies = json.loads((data / "exports/empresas_cedentes_capital.json").read_text(encoding="utf8"))
    print(json.dumps({"cnpjs": len(companies)}), flush=True)
    records = {}
    limiter = RateLimiter(0.2)
    last_progress = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        if args.offline:
            for company in companies:
                path = data / 'localizacao' / (company['cnpj'] + '.json')
                if not path.exists():
                    raise ValueError('Consulta ainda não realizada: ' + company['cnpj'])
        futures = [executor.submit(fetch_location, normalize_cnpj(row["cnpj"]),
                                   data / "localizacao", limiter) for row in companies]
        for count, future in enumerate(concurrent.futures.as_completed(futures), 1):
            record = future.result()
            records[record["cnpj"]] = record
            if count % 50 == 0 or time.monotonic() - last_progress > 30:
                print(json.dumps({"consultados": count, "total": len(companies),
                                  "enderecos_encontrados": sum(r["status"] == "ok" for r in records.values()),
                                  "outros_status": sum(r["status"] != "ok" for r in records.values())}), flush=True)
                last_progress = time.monotonic()
    enriched = []
    supplements_path = data / 'localizacao_complementos.json'
    supplements = json.loads(supplements_path.read_text(encoding='utf8')) if supplements_path.exists() else {}
    for company in companies:
        record = records[company["cnpj"]]
        if record["cnpj"] != company["cnpj"]:
            raise ValueError("localizacao_de_outro_cnpj")
        item = {**company, "cidade": record["cidade"], "uf": record["uf"], 'estado': record['uf'],
                         "status_localizacao": record["status"], "url_localizacao": record["url_fonte"],
                         "data_consulta_localizacao": record["data_consulta"]}
        if company['cnpj'] in supplements:
            supplement = supplements[company['cnpj']]
            if record['uf'] != 'EX' or supplement['cnpj'] != company['cnpj']:
                raise ValueError('Complemento de localização divergente do CNPJ estrangeiro')
            item.update(cidade=supplement['cidade'], estado=supplement['estado'],
                        url_localizacao=supplement['url_fonte'],
                        fonte_localizacao_complementar=supplement)
        enriched.append(item)
    report = {"cnpjs": len(enriched),
              "cidade_uf_brasil": sum(r["status_localizacao"] == "ok" for r in enriched),
              "exterior": sum(r["uf"] == "EX" for r in enriched),
              "pendencias": [r["cnpj"] for r in enriched if r["status_localizacao"] not in ("ok", "exterior")],
              "data_execucao": datetime.now(timezone.utc).isoformat()}
    for filename, content in (("empresas_cedentes_localizacao.json", enriched),
                              ("relatorio_localizacao.json", report)):
        (data / "exports" / filename).write_text(json.dumps(content, ensure_ascii=False, indent=2), encoding="utf8")
    with sqlite3.connect(data / "radar.sqlite3") as db:
        db.execute("""CREATE TABLE IF NOT EXISTS localizacao_cedentes (
            cnpj TEXT PRIMARY KEY, cidade TEXT, uf TEXT, status TEXT NOT NULL,
            url_fonte TEXT NOT NULL, data_consulta TEXT NOT NULL, dados_json TEXT NOT NULL)""")
        for cnpj, record in records.items():
            db.execute("INSERT OR REPLACE INTO localizacao_cedentes VALUES (?,?,?,?,?,?,?)",
                       (cnpj, record["cidade"], record["uf"], record["status"], record["url_fonte"],
                        record["data_consulta"], json.dumps(record, ensure_ascii=False)))
    print(json.dumps(report, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
