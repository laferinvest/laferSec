"""ETL CVM/FIDC determinístico, usando somente a biblioteca padrão do Python.

Execute da raiz do projeto: python -m radar_cedentes.cvm_fidc --mes 202608
"""

from __future__ import annotations

import argparse
from collections import Counter
import csv
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
from html.parser import HTMLParser
import io
import json
import logging
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen
import zipfile

BASE = "https://dados.cvm.gov.br/dados/FIDC/DOC/INF_MENSAL/"
DATA_URL = BASE + "DADOS/"
HISTORY_URL = DATA_URL + "HIST/"
DICTIONARY_URL = BASE + "META/meta_inf_mensal_fidc_txt.zip"
DEFAULT_DATA = Path(__file__).resolve().parent / "data"
PARSER_VERSION = "1.0.0"
CEDENTE_FIELD = re.compile(r"TAB_I2([AB])12_CPF_CNPJ_CEDENTE_([1-9])\Z")
TABLE_I = re.compile(r"inf_mensal_fidc_tab_I_(\d{4}(?:\d{2})?)\.csv\Z", re.I)
ARCHIVE = re.compile(r"inf_mensal_fidc_(\d{4}(?:\d{2})?)\.zip\Z")
RISK_BLOCKS = {
    "A": "com aquisição substancial dos riscos e benefícios",
    "B": "sem aquisição substancial dos riscos e benefícios",
}
LOG = logging.getLogger("radar_cedentes")


class LayoutError(ValueError):
    """Não é seguro interpretar o arquivo com o layout conhecido."""


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def json_text(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def normalize_cnpj(raw: str) -> str:
    """Valida CNPJ numérico/alfanumérico; nunca converte CPF em CNPJ.

    A CVM pode remover zeros à esquerda. Só recuperamos identificadores
    numéricos de 12/13 posições, com DV válido. Até 11 são ambíguos.
    """
    raw = raw.strip().upper()
    if not raw:
        raise ValueError("vazio")
    if re.search(r"[^A-Z0-9./\-\s]", raw):
        raise ValueError("formato_invalido")
    value = re.sub(r"[./\-\s]", "", raw)
    if value.isascii() and value.isdigit() and len(value) <= 11:
        raise ValueError("cpf_ou_identificador_ambiguo")
    if value.isascii() and value.isdigit() and len(value) in (12, 13):
        value = value.zfill(14)
    if not re.fullmatch(r"[A-Z0-9]{12}[0-9]{2}", value):
        raise ValueError("formato_invalido")
    if len(set(value)) == 1:
        raise ValueError("identificador_generico")
    body = value[:12]
    for weights in ((5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2),
                    (6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2)):
        remainder = sum((ord(c) - 48) * w for c, w in zip(body, weights)) % 11
        body += str(0 if remainder < 2 else 11 - remainder)
    if value != body:
        raise ValueError("digitos_verificadores_invalidos")
    return value


def parse_percent(raw: str) -> tuple[str | None, str | None]:
    if not raw.strip():
        return None, "percentual_ausente"
    text = raw.strip()
    # CSVs atuais usam ponto decimal; aceita também a notação brasileira.
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    try:
        value = Decimal(text)
    except InvalidOperation:
        return None, "percentual_invalido"
    if not value.is_finite() or value < 0:
        return None, "percentual_invalido"
    # O denominador é PL: não descartar valores >100 nem convertê-los para 0..1.
    warning = "percentual_acima_100_revisar" if value > 100 else None
    if value <= 10:
        warning = "percentual_ate_10_revisar"
    return format(value, "f"), warning


def file_hash(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def archive_period(path: Path) -> str:
    match = ARCHIVE.fullmatch(path.name)
    if not match:
        raise ValueError("Use o nome original inf_mensal_fidc_AAAAMM.zip ou AAAA.zip.")
    return match[1]


def validate_month(value: str) -> str:
    if not re.fullmatch(r"\d{6}", value):
        raise argparse.ArgumentTypeError("Competência deve usar AAAAMM, por exemplo 202608.")
    try:
        date(int(value[:4]), int(value[4:]), 1)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Competência inválida.") from exc
    return value


def validate_source(url: str, name: str) -> None:
    if url not in (DATA_URL + name, HISTORY_URL + name):
        raise ValueError("A fonte deve ser a URL HTTPS oficial do ZIP no diretório CVM/FIDC.")


def request(url: str):
    req = Request(url, headers={"User-Agent": "RadarCedentes/1.0 (public CVM data ETL)"})
    for attempt in range(3):
        try:
            return urlopen(req, timeout=30)
        except HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504) or attempt == 2:
                raise
        except (URLError, TimeoutError):
            if attempt == 2:
                raise
        time.sleep(1 + attempt)
    raise RuntimeError("Falha no download.")


class ArchiveLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.names: set[str] = set()

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            href = dict(attrs).get("href", "")
            if ARCHIVE.fullmatch(href):
                self.names.add(href)


def discover_archives() -> dict[str, str]:
    archives = {}
    for directory in (DATA_URL, HISTORY_URL):
        with request(directory) as response:
            parser = ArchiveLinks()
            parser.feed(response.read().decode("utf-8"))
        for name in sorted(parser.names):
            archives[ARCHIVE.fullmatch(name)[1]] = urljoin(directory, name)
    if not archives:
        raise LayoutError("Nenhum ZIP descoberto; verificar índice público da CVM.")
    return archives


def available_months(archives: dict[str, str]) -> list[str]:
    months = set()
    for period in archives:
        if len(period) == 6:
            months.add(validate_month(period))
        else:
            months.update(f"{period}{month:02d}" for month in range(1, 13))
    return sorted(months)


def preserve_archive(path: Path, raw_dir: Path) -> tuple[Path, str]:
    if not zipfile.is_zipfile(path):
        raise LayoutError("Download não é um ZIP válido.")
    digest = file_hash(path)
    target = raw_dir / digest / path.name
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        shutil.copyfile(path, target)
    elif file_hash(target) != digest:
        raise LayoutError("Arquivo preservado não confere com SHA-256.")
    return target.resolve(), digest


def download_archive(url: str, raw_dir: Path) -> tuple[Path, str]:
    name = url.rsplit("/", 1)[-1]
    validate_source(url, name)
    raw_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=raw_dir) as temp:
        destination = Path(temp) / name
        with request(url) as response, destination.open("wb") as output:
            shutil.copyfileobj(response, output)
        return preserve_archive(destination, raw_dir)


def open_csv(archive: zipfile.ZipFile, member: str):
    if archive.getinfo(member).file_size > 150_000_000:
        raise LayoutError("Tabela I maior que o limite de segurança de 150 MB.")
    raw = archive.read(member)
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text, newline=""), delimiter=";")
    fields = reader.fieldnames or []
    if len(fields) != len(set(fields)):
        raise LayoutError("Colunas duplicadas na tabela I.")
    required = {"DT_COMPTC", "DENOM_SOCIAL", "ADMIN", "CNPJ_ADMIN"}
    if not required.issubset(fields) or not {"CNPJ_FUNDO_CLASSE", "CNPJ_FUNDO"}.intersection(fields):
        raise LayoutError("Colunas de identificação ausentes na tabela I.")
    cedente_fields = [f for f in fields if CEDENTE_FIELD.fullmatch(f)]
    if not cedente_fields:
        raise LayoutError("Campos de CNPJ de cedente ausentes; revisar layout antes de importar.")
    for field in cedente_fields:
        if field.replace("CPF_CNPJ", "PR") not in fields:
            raise LayoutError("Campo de participação ausente para " + field)
    unexpected = [f for f in fields if "CEDENTE" in f and f not in cedente_fields
                  and f not in {c.replace("CPF_CNPJ", "PR") for c in cedente_fields}]
    if unexpected:
        raise LayoutError("Novos campos de cedente não mapeados: " + ", ".join(unexpected))
    return reader, cedente_fields


def extract(path: Path, months: set[str], source_url: str, digest: str):
    """Retorna evidências empresariais, auditoria e competências efetivamente lidas."""
    evidence = []
    stats = Counter()
    rejected = []
    seen_months = set()
    identities = set()
    with zipfile.ZipFile(path) as archive:
        members = [m for m in archive.namelist() if TABLE_I.fullmatch(m)]
        if not members:
            raise LayoutError("ZIP não contém tabela I.")
        for member in members:
            member_period = TABLE_I.fullmatch(member)[1]
            if len(member_period) == 6 and member_period not in months:
                continue
            reader, fields = open_csv(archive, member)
            for row_index, row in enumerate(reader, start=1):
                if None in row or any(v is None for v in row.values()):
                    raise LayoutError(f"Linha incompleta ou com colunas excedentes: {member}, {row_index}.")
                try:
                    dt = date.fromisoformat(row["DT_COMPTC"])
                except ValueError as exc:
                    raise LayoutError(f"Data inválida em {member}, registro {row_index}.") from exc
                month = dt.strftime("%Y%m")
                if month not in months:
                    continue
                seen_months.add(month)
                stats["registros_fundos_classes"] += 1
                is_class = row.get("TP_FUNDO_CLASSE", "").lower() == "classe"
                raw_entity = row.get("CNPJ_FUNDO_CLASSE") or row.get("CNPJ_FUNDO", "")
                try:
                    entity = normalize_cnpj(raw_entity)
                except ValueError as exc:
                    raise LayoutError(f"CNPJ do fundo/classe inválido em {member}, registro {row_index}.") from exc
                identity = (row.get("TP_FUNDO_CLASSE", "Fundo"), entity, row["DT_COMPTC"])
                if identity in identities:
                    raise LayoutError("Mais de um registro por fundo/classe/competência; revisar reapresentações.")
                identities.add(identity)
                for field in fields:
                    if not row[field].strip():
                        continue
                    stats["identificacoes_preenchidas"] += 1
                    try:
                        cnpj = normalize_cnpj(row[field])
                    except ValueError as exc:
                        reason = str(exc)
                        stats["rejeitados_" + reason] += 1
                        rejected.append({"arquivo": member, "registro_csv": row_index,
                                         "campo": field, "motivo": reason})
                        continue
                    group, slot = CEDENTE_FIELD.fullmatch(field).groups()
                    percent_field = field.replace("CPF_CNPJ", "PR")
                    percent, warning = parse_percent(row[percent_field])
                    warnings = [warning] if warning else []
                    normalized_input = re.sub(r"[./\-\s]", "", row[field].upper())
                    if len(normalized_input) in (12, 13):
                        warnings.append("zeros_esquerda_recuperados_com_dv_valido")
                    for flag in warnings:
                        stats["alertas_" + flag] += 1
                    original = {k: row[k] for k in ("DT_COMPTC", "DENOM_SOCIAL", "CNPJ_ADMIN", "ADMIN",
                                                   field, percent_field)}
                    for k in ("TP_FUNDO_CLASSE", "CNPJ_FUNDO_CLASSE", "CNPJ_FUNDO", "CNPJ_CLASSE", "CLASSE"):
                        if k in row:
                            original[k] = row[k]
                    # CNPJ_FUNDO_CLASSE pode ser o CNPJ da classe: não atribuir ao fundo pai.
                    fund_cnpj = None if is_class else entity
                    class_cnpj = entity if is_class else None
                    if not is_class and row.get("CNPJ_CLASSE", "").strip():
                        try:
                            class_cnpj = normalize_cnpj(row["CNPJ_CLASSE"])
                        except ValueError:
                            warnings.append("cnpj_classe_invalido")
                    excerpt = "; ".join(f"{k}={v}" for k, v in original.items())
                    key = json_text([digest, member, row_index, field, cnpj])
                    evidence.append({
                        "id": hashlib.sha256(key.encode()).hexdigest(), "cnpj": cnpj,
                        "razao_social": None, "fonte_tipo": "cvm_fidc_informe_mensal",
                        "fundo_ou_operacao": row["DENOM_SOCIAL"], "papel": "cedente",
                        "cnpj_fundo": fund_cnpj, "cnpj_classe": class_cnpj,
                        "cnpj_fundo_classe": entity, "tipo_entidade": identity[0],
                        "percentual_concentracao": percent,
                        "base_percentual": "patrimonio_liquido_fundo_classe",
                        "data_evidencia": row["DT_COMPTC"], "competencia": month,
                        "tipo_direito_creditorio": None, "bloco_riscos_beneficios": RISK_BLOCKS[group],
                        "administrador": row["ADMIN"], "cnpj_administrador": row["CNPJ_ADMIN"],
                        "gestor": None, "url_fonte": source_url, "pagina": None,
                        "trecho_evidencia": excerpt, "arquivo_csv": member,
                        "registro_csv": row_index, "linha_final_csv": reader.line_num,
                        "campo_identificacao": field, "campo_percentual": percent_field,
                        "dados_originais_json": json_text(original), "alertas_json": json_text(warnings),
                        "arquivo_sha256": digest, "caminho_arquivo": str(path.resolve()),
                        "versao_parser": PARSER_VERSION,
                    })
                    stats["evidencias_cnpj_validado"] += 1
    missing = months - seen_months
    if missing:
        raise LayoutError("Competências sem registros na tabela I: " + ", ".join(sorted(missing)))
    return evidence, dict(stats), rejected, seen_months


SCHEMA = """
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS cedentes (
    cnpj TEXT PRIMARY KEY, razao_social TEXT, primeira_coleta TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS evidencias (
    id TEXT PRIMARY KEY, cnpj TEXT NOT NULL REFERENCES cedentes(cnpj), razao_social TEXT,
    fonte_tipo TEXT NOT NULL, fundo_ou_operacao TEXT NOT NULL, papel TEXT NOT NULL,
    cnpj_fundo TEXT, cnpj_classe TEXT, cnpj_fundo_classe TEXT, tipo_entidade TEXT,
    percentual_concentracao TEXT, base_percentual TEXT, data_evidencia TEXT NOT NULL,
    competencia TEXT NOT NULL, tipo_direito_creditorio TEXT, bloco_riscos_beneficios TEXT,
    administrador TEXT, cnpj_administrador TEXT, gestor TEXT,
    url_fonte TEXT NOT NULL, pagina INTEGER, trecho_evidencia TEXT NOT NULL,
    arquivo_csv TEXT, registro_csv INTEGER, linha_final_csv INTEGER,
    campo_identificacao TEXT, campo_percentual TEXT, dados_originais_json TEXT,
    alertas_json TEXT, arquivo_sha256 TEXT NOT NULL, caminho_arquivo TEXT NOT NULL,
    versao_parser TEXT NOT NULL, data_coleta TEXT NOT NULL, ultima_verificacao TEXT NOT NULL,
    vigente_na_fonte INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS evidencias_cnpj ON evidencias(cnpj);
CREATE INDEX IF NOT EXISTS evidencias_competencia ON evidencias(fonte_tipo, competencia);
CREATE TABLE IF NOT EXISTS coletas (
    id INTEGER PRIMARY KEY, arquivo_sha256 TEXT NOT NULL, url_fonte TEXT NOT NULL,
    caminho_arquivo TEXT NOT NULL, competencias_json TEXT NOT NULL,
    data_coleta TEXT NOT NULL, versao_parser TEXT NOT NULL,
    estatisticas_json TEXT NOT NULL, rejeicoes_json TEXT NOT NULL
);
"""


def persist(db: sqlite3.Connection, evidence: list[dict], months: set[str],
            source_url: str, path: Path, digest: str, stats: dict, rejected: list):
    collected_at = now_utc()
    with db:
        # Só reconciliar após analisar e validar toda a entrada, inclusive meses sem leads.
        for month in sorted(months):
            db.execute("UPDATE evidencias SET vigente_na_fonte=0 WHERE fonte_tipo=? AND competencia=?",
                       ("cvm_fidc_informe_mensal", month))
        for item in evidence:
            db.execute("INSERT OR IGNORE INTO cedentes(cnpj, primeira_coleta) VALUES (?, ?)",
                       (item["cnpj"], collected_at))
            record = {**item, "data_coleta": collected_at, "ultima_verificacao": collected_at,
                      "vigente_na_fonte": 1}
            columns = list(record)
            placeholders = ",".join("?" for _ in columns)
            db.execute(f"INSERT INTO evidencias({','.join(columns)}) VALUES ({placeholders}) "
                       "ON CONFLICT(id) DO UPDATE SET ultima_verificacao=excluded.ultima_verificacao, "
                       "vigente_na_fonte=1", list(record.values()))
        db.execute("INSERT INTO coletas(arquivo_sha256,url_fonte,caminho_arquivo,competencias_json,"
                   "data_coleta,versao_parser,estatisticas_json,rejeicoes_json) VALUES (?,?,?,?,?,?,?,?)",
                   (digest, source_url, str(path), json_text(sorted(months)), collected_at,
                    PARSER_VERSION, json_text(stats), json_text(rejected)))


def export_query(db: sqlite3.Connection, query: str, destination: Path):
    cursor = db.execute(query)
    # CNPJ é texto no banco. Ao abrir no Excel, importar essa coluna como texto.
    with destination.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.writer(output, delimiter=";")
        writer.writerow([d[0] for d in cursor.description])
        writer.writerows(cursor)


def export_database(db: sqlite3.Connection, output: Path) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    export_query(db, "SELECT * FROM evidencias WHERE vigente_na_fonte=1 "
                 "ORDER BY cnpj,data_evidencia,arquivo_csv,registro_csv,campo_identificacao",
                 output / "evidencias.csv")
    export_query(db, "SELECT * FROM evidencias ORDER BY cnpj,data_evidencia,id",
                 output / "historico_evidencias.csv")
    export_query(db, "SELECT c.cnpj,c.razao_social,MIN(e.data_evidencia) primeira_evidencia,"
                 "MAX(e.data_evidencia) ultima_evidencia,COUNT(*) quantidade_evidencias,"
                 "COUNT(DISTINCT e.cnpj_fundo_classe) quantidade_fundos_classes "
                 "FROM cedentes c JOIN evidencias e ON c.cnpj=e.cnpj "
                 "WHERE e.vigente_na_fonte=1 GROUP BY c.cnpj ORDER BY c.cnpj", output / "cedentes.csv")
    return {
        "cnpjs_unicos": db.execute("SELECT COUNT(DISTINCT cnpj) FROM evidencias WHERE vigente_na_fonte=1").fetchone()[0],
        "evidencias_vigentes": db.execute("SELECT COUNT(*) FROM evidencias WHERE vigente_na_fonte=1").fetchone()[0],
        "evidencias_historicas": db.execute("SELECT COUNT(*) FROM evidencias").fetchone()[0],
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Radar de cedentes: informes mensais públicos CVM/FIDC.")
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--mes", action="append", type=validate_month, help="AAAAMM; pode repetir a opção.")
    scope.add_argument("--ultimos", type=int, help="Coletar os N meses mais recentes publicados, p.ex. 12.")
    parser.add_argument("--zip", type=Path, help="ZIP local com nome original; leitura sem rede.")
    parser.add_argument("--url-fonte", help="URL oficial para o ZIP local (inferida pelo nome se omitida).")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.ultimos is not None and not 1 <= args.ultimos <= 120:
        parser.error("--ultimos deve estar entre 1 e 120.")
    if args.zip and not args.mes:
        parser.error("--zip exige --mes para declarar a competência a importar.")
    if args.url_fonte and not args.zip:
        parser.error("--url-fonte exige --zip.")
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    args.data_dir = args.data_dir.resolve()
    raw_dir = args.data_dir / "raw"
    output = args.data_dir / "exports"
    try:
        if args.zip:
            period = archive_period(args.zip)
            url = args.url_fonte or (DATA_URL if len(period) == 6 else HISTORY_URL) + args.zip.name
            validate_source(url, args.zip.name)
            jobs = [(url, set(args.mes), args.zip)]
        else:
            archives = discover_archives()
            months = args.mes or available_months(archives)[-args.ultimos:]
            jobs_by_url = {}
            for month in sorted(set(months)):
                url = archives.get(month) or archives.get(month[:4])
                if not url:
                    raise ValueError("Competência não publicada: " + month)
                jobs_by_url.setdefault(url, set()).add(month)
            jobs = [(url, months, None) for url, months in jobs_by_url.items()]
        args.data_dir.mkdir(parents=True, exist_ok=True)
        reports = []
        with sqlite3.connect(args.data_dir / "radar.sqlite3") as db:
            db.executescript(SCHEMA)
            for url, months, local in jobs:
                LOG.info("Coletando %s", ", ".join(sorted(months)))
                path, digest = preserve_archive(local, raw_dir) if local else download_archive(url, raw_dir)
                evidence, stats, rejected, seen_months = extract(path, months, url, digest)
                persist(db, evidence, seen_months, url, path, digest, stats, rejected)
                reports.append({"url_fonte": url, "sha256": digest,
                                "competencias": sorted(seen_months), "estatisticas": stats})
                LOG.info("%s registros; %s evidências com CNPJ validado.",
                         stats.get("registros_fundos_classes", 0), len(evidence))
            totals = export_database(db, output)
        report = {"data_execucao": now_utc(), "versao_parser": PARSER_VERSION,
                  "coletas": reports, "base": totals}
        (output / "relatorio_coleta.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        LOG.info("Base: %s CNPJs únicos; %s evidências vigentes. Saída: %s",
                 totals["cnpjs_unicos"], totals["evidencias_vigentes"], output)
        return 0
    except (ValueError, OSError, sqlite3.Error, zipfile.BadZipFile) as exc:
        LOG.error("Coleta interrompida: %s", exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
