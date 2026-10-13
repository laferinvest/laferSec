"""Consulta capital social cadastral das empresas da lista, com origem e cache."""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import re
import sqlite3
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

from .cvm_fidc import normalize_cnpj
from .empresas_cedentes import HEADERS, RateLimiter

LOOKUP_URL = "https://api.opencnpj.org/"


def validate_capital(cnpj: str, payload: dict, url: str) -> dict:
    if normalize_cnpj(str(payload.get("cnpj", ""))) != cnpj:
        raise ValueError("cnpj_da_resposta_divergente")
    value = payload.get("capital_social")
    if value is None or value == "":
        capital, status = None, "nao_informado"
    else:
        if isinstance(value, bool):
            raise ValueError("capital_social_invalido")
        try:
            text = str(value)
            if "," in text:
                if not re.fullmatch(r"(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}", text):
                    raise ValueError("capital_social_invalido")
                text = text.replace(".", "").replace(",", ".")
            amount = Decimal(text)
            if not amount.is_finite() or amount < 0 or amount != amount.quantize(Decimal("0.01")):
                raise ValueError("capital_social_invalido")
            capital, status = format(amount, ".2f"), "ok"
        except InvalidOperation as exc:
            raise ValueError("capital_social_invalido") from exc
    return {"cnpj_consultado": cnpj, "cnpj_basico": cnpj[:8],
            "razao_social_cadastro": payload.get("razao_social"),
            "capital_social": capital, "moeda": "BRL", "status": status,
            "url_fonte": url, "campo_fonte": "capital_social"}


def fetch_capital(cnpj: str, cache_dir: Path, limiter: RateLimiter) -> dict:
    destination = cache_dir / f"{cnpj[:8]}.json"
    if destination.exists():
        cached = json.loads(destination.read_text(encoding="utf8"))
        if cached.get("cnpj_consultado") == cnpj and cached.get("status") in ("ok", "nao_informado"):
            return cached
    url = LOOKUP_URL + cnpj
    record, error = None, None
    for attempt in range(3):
        limiter.wait()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=20) as response:
                raw = response.read()
            payload = json.loads(raw, parse_float=Decimal)
            record = validate_capital(cnpj, payload, url)
            record["resposta_sha256"] = hashlib.sha256(raw).hexdigest()
            break
        except urllib.error.HTTPError as exc:
            error = f"HTTP {exc.code}"
            if exc.code == 404:
                record = {"cnpj_consultado": cnpj, "cnpj_basico": cnpj[:8],
                          "capital_social": None, "status": "cadastro_nao_encontrado", "url_fonte": url}
                break
            if exc.code in (401, 403):
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
        record = {"cnpj_consultado": cnpj, "cnpj_basico": cnpj[:8], "capital_social": None,
                  "status": "erro", "erro": error, "url_fonte": url}
    record["data_consulta"] = datetime.now(timezone.utc).isoformat()
    cache_dir.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".json.part")
    temporary.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf8")
    temporary.replace(destination)
    return record


def enrich(companies: list[dict], records: dict[str, dict]) -> list[dict]:
    result = []
    for company in companies:
        cnpj = normalize_cnpj(company["cnpj"])
        record = records.get(cnpj[:8])
        if record is None or record.get("cnpj_basico") != cnpj[:8]:
            raise ValueError("consulta_ausente_ou_empresa_divergente: " + cnpj)
        if normalize_cnpj(record["cnpj_consultado"])[:8] != cnpj[:8]:
            raise ValueError("cnpj_consultado_de_outra_empresa")
        result.append({**company, "capital_social": record.get("capital_social"),
                       "status_capital": record["status"], "url_capital": record["url_fonte"],
                       "cnpj_consultado_capital": record["cnpj_consultado"],
                       "data_consulta_capital": record["data_consulta"]})
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path("radar_cedentes/data"))
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args(argv)
    companies = json.loads((args.data_dir / "exports/empresas_cedentes.json").read_text(encoding="utf8"))
    representatives = {}
    for company in sorted(companies, key=lambda row: row["cnpj"]):
        cnpj = normalize_cnpj(company["cnpj"])
        representatives.setdefault(cnpj[:8], cnpj)
    cache_dir = args.data_dir / "capital_social"
    records = {}
    for base, cnpj in representatives.items():
        path = cache_dir / f"{base}.json"
        if path.exists():
            record = json.loads(path.read_text(encoding="utf8"))
            if record.get("cnpj_consultado") == cnpj:
                records[base] = record
    pending = [cnpj for base, cnpj in representatives.items()
               if records.get(base, {}).get("status") not in ("ok", "nao_informado")]
    print(json.dumps({"linhas_planilha": len(companies), "empresas_cnpj_basico": len(representatives),
                      "consultas_pendentes": len(pending)}), flush=True)
    if not args.offline:
        limiter = RateLimiter(0.2)
        last_progress = time.monotonic()
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            futures = [executor.submit(fetch_capital, cnpj, cache_dir, limiter) for cnpj in pending]
            for count, future in enumerate(concurrent.futures.as_completed(futures), 1):
                record = future.result()
                records[record["cnpj_basico"]] = record
                if count % 50 == 0 or time.monotonic() - last_progress > 30:
                    print(json.dumps({"consultados": count, "total": len(pending),
                                      "capitais_encontrados": sum(r["status"] == "ok" for r in records.values()),
                                      "sem_valor": sum(r["status"] != "ok" for r in records.values())}), flush=True)
                    last_progress = time.monotonic()
    enriched = enrich(companies, records)
    output = args.data_dir / "exports"
    (output / "empresas_cedentes_capital.json").write_text(
        json.dumps(enriched, ensure_ascii=False, indent=2), encoding="utf8")
    report = {"linhas_planilha": len(enriched), "empresas_cnpj_basico": len(representatives),
              "linhas_com_capital_social": sum(row["status_capital"] == "ok" for row in enriched),
              "linhas_capital_zero_informado": sum(row["capital_social"] == "0.00" for row in enriched),
              "linhas_sem_capital_confirmado": sum(row["status_capital"] != "ok" for row in enriched),
              "data_execucao": datetime.now(timezone.utc).isoformat(),
              "observacao": "Capital cadastral consultado agora; não é capital histórico de agosto/2026. "
                            "Matriz e filiais da mesma pessoa jurídica compartilham o capital social."}
    (output / "relatorio_capital_social.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf8")
    with sqlite3.connect(args.data_dir / "radar.sqlite3") as db:
        db.execute("""CREATE TABLE IF NOT EXISTS capital_social_cedentes (
            cnpj_basico TEXT PRIMARY KEY, cnpj_consultado TEXT NOT NULL,
            capital_social TEXT, moeda TEXT NOT NULL, status TEXT NOT NULL,
            url_fonte TEXT NOT NULL, data_consulta TEXT NOT NULL, dados_json TEXT NOT NULL)""")
        for base, record in records.items():
            db.execute("INSERT OR REPLACE INTO capital_social_cedentes VALUES (?,?,?,?,?,?,?,?)",
                       (base, record["cnpj_consultado"], record.get("capital_social"), "BRL",
                        record["status"], record["url_fonte"], record["data_consulta"],
                        json.dumps(record, ensure_ascii=False)))
    print(json.dumps(report, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
