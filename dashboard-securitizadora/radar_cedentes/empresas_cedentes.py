"""Enriquece os CNPJs declarados como cedentes, sem usar nomes de fundos.

Consulta cadastral pública e cache retomável. A evidência da cessão permanece
no informe CVM; a consulta de CNPJ fornece apenas a razão social/classificação.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import csv
import hashlib
import io
import json
import sqlite3
import threading
import time
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from .cvm_fidc import normalize_cnpj

CAD_URL = "https://dados.cvm.gov.br/dados/FI/CAD/DADOS/"
LOOKUP_URL = "https://minhareceita.org/"
HEADERS = {"User-Agent": "RadarCedentes/1.0 (public-business-register-lookup)",
           "Accept": "application/json"}


def decode_csv(data: bytes) -> str:
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("latin1")


def fund_register(raw_dir: Path, download: bool = True) -> dict[str, dict]:
    """Somente CNPJ do próprio fundo/classe; nunca administrador/gestor."""
    entries = {}
    for filename in ("cad_fi.csv", "registro_fundo_classe.zip"):
        path = raw_dir / filename
        if not path.exists():
            if not download:
                raise FileNotFoundError(path)
            raw_dir.mkdir(parents=True, exist_ok=True)
            request = urllib.request.Request(CAD_URL + filename, headers=HEADERS)
            with urllib.request.urlopen(request, timeout=60) as response:
                temporary = path.with_suffix(path.suffix + ".part")
                temporary.write_bytes(response.read())
                temporary.replace(path)
        if filename.endswith(".zip"):
            with zipfile.ZipFile(path) as archive:
                members = [(name, archive.read(name)) for name in archive.namelist()
                           if name.lower().endswith(".csv")]
        else:
            members = [(filename, path.read_bytes())]
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        for member, content in members:
            for original in csv.DictReader(io.StringIO(decode_csv(content)), delimiter=";"):
                row = {key.upper(): value for key, value in original.items()}
                for key in ("CNPJ_FUNDO", "CNPJ_CLASSE"):
                    raw = row.get(key, "")
                    if not raw:
                        continue
                    try:
                        cnpj = normalize_cnpj(raw)
                    except ValueError:
                        continue
                    entries[cnpj] = {
                        "cnpj": cnpj,
                        "nome": row.get("DENOM_SOCIAL") or row.get("DENOMINACAO_SOCIAL"),
                        "url": CAD_URL + filename,
                        "arquivo_csv": member,
                        "sha256": digest,
                    }
    return entries


def classify(cnpj: str, record: dict, funds: dict) -> str:
    if cnpj in funds:
        return "fundo_ou_classe_cvm"
    if record.get("status") != "ok":
        return "cadastro_nao_resolvido"
    code = record.get("codigo_natureza_juridica")
    if code == 2224:
        return "fundo_ou_classe_cadastral"
    if code is None:
        return "natureza_juridica_ausente"
    if not 2000 <= code < 3000:
        return "outra_natureza_juridica"
    return "empresa"


class RateLimiter:
    def __init__(self, interval: float):
        self.interval = interval
        self.lock = threading.Lock()
        self.next_request = 0.0

    def wait(self):
        with self.lock:
            delay = max(0, self.next_request - time.monotonic())
            self.next_request = max(time.monotonic(), self.next_request) + self.interval
        if delay:
            time.sleep(delay)


def validate_response(cnpj: str, payload: dict, url: str) -> dict:
    # Uma resposta de outro CNPJ não pode preencher o nome do cedente.
    if normalize_cnpj(str(payload.get("cnpj", ""))) != cnpj:
        raise ValueError("cnpj_da_resposta_divergente")
    name = payload.get("razao_social")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("razao_social_ausente")
    code = payload.get("codigo_natureza_juridica")
    return {
        "cnpj": cnpj, "razao_social": name.strip(),
        "codigo_natureza_juridica": int(code) if code is not None else None,
        "natureza_juridica": payload.get("natureza_juridica"),
        "situacao_cadastral": payload.get("situacao_cadastral"),
        "url": url, "status": "ok",
    }


def lookup(cnpj: str, cache_dir: Path, limiter: RateLimiter) -> dict:
    path = cache_dir / (cnpj + ".json")
    if path.exists():
        cached = json.loads(path.read_text(encoding="utf8"))
        if cached.get("cnpj") == cnpj and cached.get("status") in ("ok", "nao_encontrado"):
            return cached
    url = LOOKUP_URL + cnpj
    error = None
    for attempt in range(3):
        limiter.wait()
        try:
            request = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(request, timeout=20) as response:
                raw = response.read()
            record = validate_response(cnpj, json.loads(raw), url)
            record["resposta_sha256"] = hashlib.sha256(raw).hexdigest()
            break
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                record = {"cnpj": cnpj, "url": url, "status": "nao_encontrado"}
                break
            error = f"HTTP {exc.code}"
            if exc.code in (401, 403):
                break
            if attempt < 2:
                time.sleep(min(30, int(exc.headers.get("Retry-After", "0")) or 2 ** (attempt + 1)))
        except (ValueError, OSError) as exc:
            error = str(exc)
            if attempt < 2:
                time.sleep(2 ** (attempt + 1))
    else:
        record = {"cnpj": cnpj, "url": url, "status": "erro", "erro": error}
    if "record" not in locals():
        record = {"cnpj": cnpj, "url": url, "status": "erro", "erro": error}
    record["data_consulta"] = datetime.now(timezone.utc).isoformat()
    cache_dir.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.part")
    temporary.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf8")
    temporary.replace(path)
    return record


def export_companies(db: sqlite3.Connection, output: Path, records: dict, funds: dict) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    ids = [row[0] for row in db.execute(
        "SELECT DISTINCT cnpj FROM evidencias WHERE vigente_na_fonte=1 ORDER BY cnpj")]
    companies, excluded, pending = [], [], []
    for cnpj in ids:
        record = records.get(cnpj, {"cnpj": cnpj})
        kind = classify(cnpj, record, funds)
        if kind == "empresa":
            companies.append({"cnpj": cnpj, "razao_social": record["razao_social"]})
        elif kind in ("cadastro_nao_resolvido", "natureza_juridica_ausente"):
            pending.append({"cnpj": cnpj, "motivo": kind, "cadastro": record})
        else:
            excluded.append({"cnpj": cnpj, "motivo": kind,
                             "cadastro": funds.get(cnpj) or record})
    companies.sort(key=lambda row: (row["razao_social"], row["cnpj"]))
    with (output / "empresas_cedentes.csv").open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.DictWriter(stream, fieldnames=["cnpj", "razao_social"], delimiter=";")
        writer.writeheader()
        writer.writerows(companies)
    report = {"cnpjs_declarados_como_cedentes": len(ids), "empresas": len(companies),
              "fundos_classes_excluidos": sum("fundo" in row["motivo"] for row in excluded),
              "outras_entidades_excluidas": sum("fundo" not in row["motivo"] for row in excluded),
              "cadastros_pendentes": len(pending)}
    for filename, payload in (("empresas_cedentes.json", companies),
                              ("exclusoes_empresas.json", excluded),
                              ("cadastros_pendentes.json", pending),
                              ("relatorio_empresas.json", report)):
        (output / filename).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf8")
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path("radar_cedentes/data"))
    parser.add_argument("--offline", action="store_true", help="Exporta apenas consultas já em cache.")
    parser.add_argument("--intervalo", type=float, default=0.35)
    args = parser.parse_args(argv)
    if args.intervalo < 0.35:
        parser.error("Use intervalo de pelo menos 0,35 segundo entre consultas.")
    funds = fund_register(args.data_dir / "raw", download=not args.offline)
    db = sqlite3.connect(args.data_dir / "radar.sqlite3")
    db.execute("""CREATE TABLE IF NOT EXISTS cadastro_cedentes (
        cnpj TEXT PRIMARY KEY REFERENCES cedentes(cnpj), razao_social TEXT,
        classificacao TEXT NOT NULL, url_cadastro TEXT, dados_json TEXT NOT NULL,
        data_consulta TEXT)""")
    ids = [row[0] for row in db.execute(
        "SELECT DISTINCT cnpj FROM evidencias WHERE vigente_na_fonte=1 ORDER BY cnpj")]
    cache_dir = args.data_dir / "cadastro_cnpj"
    records = {}
    for cnpj in ids:
        file = cache_dir / (cnpj + ".json")
        if file.exists():
            record = json.loads(file.read_text(encoding="utf8"))
            if record.get("cnpj") == cnpj:
                records[cnpj] = record
    candidates = [cnpj for cnpj in ids if cnpj not in funds
                  and records.get(cnpj, {}).get("status") not in ("ok", "nao_encontrado")]
    print(json.dumps({"cnpjs_cedentes": len(ids), "fundos_classes_cvm": len(set(ids) & set(funds)),
                      "consultas_pendentes": len(candidates)}), flush=True)
    if not args.offline:
        limiter = RateLimiter(args.intervalo)
        last_update = time.monotonic()
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            futures = {executor.submit(lookup, cnpj, cache_dir, limiter): cnpj for cnpj in candidates}
            for count, future in enumerate(concurrent.futures.as_completed(futures), 1):
                record = future.result()
                records[record["cnpj"]] = record
                if count % 50 == 0 or time.monotonic() - last_update > 30:
                    print(json.dumps({"consultados": count, "total": len(candidates),
                                      "nomes_encontrados": sum(r.get("status") == "ok" for r in records.values()),
                                      "erros": sum(r.get("status") == "erro" for r in records.values())}), flush=True)
                    last_update = time.monotonic()
    for cnpj in ids:
        record = records.get(cnpj, funds.get(cnpj, {"cnpj": cnpj}))
        kind = classify(cnpj, record, funds)
        db.execute("INSERT OR REPLACE INTO cadastro_cedentes VALUES (?,?,?,?,?,?)",
                   (cnpj, record.get("razao_social") or record.get("nome"), kind,
                    record.get("url"), json.dumps(record, ensure_ascii=False), record.get("data_consulta")))
        if record.get("status") == "ok":
            db.execute("UPDATE cedentes SET razao_social=? WHERE cnpj=?", (record["razao_social"], cnpj))
    db.commit()
    print(json.dumps(export_companies(db, args.data_dir / "exports", records, funds)), flush=True)
    db.close()


if __name__ == "__main__":
    main()
