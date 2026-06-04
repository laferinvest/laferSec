import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import * as XLSX from "xlsx";

// ==========================================
// FUNÇÕES DE LIMPEZA
// ==========================================
const cleanNumber = (val) => {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number") return val;
  let s = String(val).trim().replace(/\s/g, "");
  if (s.split(",").length === 2 && s.split(".").length >= 2) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(",", ".");
  }
  const num = parseFloat(s);
  return isNaN(num) ? null : num;
};

const cleanDate = (val) => {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().split("T")[0];
  if (typeof val === "string" && val.includes("/")) {
    const parts = val.split("/");
    if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return val;
};

const limpaChave = (val) => {
  if (val === null || val === undefined) return "";
  let s = String(val).trim();
  if (s.endsWith(".0")) s = s.slice(0, -2);
  return s;
};

const formatarMoeda = (valor) => {
  const numero = Number(valor || 0);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(numero);
};

const formatDateBR = (val) => {
  if (!val) return "";
  const s = String(val).split("T")[0];
  const parts = s.split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return String(val);
};

const getTodayIso = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const CEDENTES_IGNORADOS = ["12 -", "23 -", "2 -"];

function ultimoDiaUtilDoMes(ano, mes) {
  const d = new Date(ano, mes + 1, 0); // último dia do mês
  d.setHours(0, 0, 0, 0);

  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() - 1);
  }

  return d;
}

function calcularCreditoEmAbertoCedentesExcluidosPorData(rows, dataCorte) {
  if (!rows || rows.length === 0) return { dataCorte: null, porCedente: {}, total: 0 };

  const firstRow = rows[0];

  const emisKey = Object.keys(firstRow).find(
    (k) => k.toLowerCase().includes("emis")
  );
  const pgtoKey = Object.keys(firstRow).find(
    (k) =>
      k.toLowerCase() === "pgto" ||
      (k.toLowerCase().includes("pgto") && !k.toLowerCase().includes("vl"))
  );
  const entradaKey = Object.keys(firstRow).find(
    (k) => k.toLowerCase() === "entrada" || k.toLowerCase().includes("valor")
  );

  if (!emisKey || !entradaKey) {
    console.log("Não achei as chaves necessárias:", { emisKey, pgtoKey, entradaKey });
    return { dataCorte: null, porCedente: {}, total: 0 };
  }

  const corte = new Date(dataCorte);
  corte.setHours(23, 59, 59, 999);

  const porCedente = {};

  for (const r of rows) {
    const cliente = String(r.Cliente || "").trim();

    const ehExcluido = CEDENTES_IGNORADOS.some((prefixo) =>
      cliente.startsWith(prefixo)
    );
    if (!ehExcluido) continue;

    const emisVal = r[emisKey];
    if (!emisVal) continue;

    const dtEmis = new Date(String(emisVal).split("T")[0] + "T00:00:00");
    if (isNaN(dtEmis)) continue;

    if (dtEmis > corte) continue;

    const pgtoVal = pgtoKey ? r[pgtoKey] : null;
    let emAberto = false;

    if (!pgtoVal || String(pgtoVal).trim() === "") {
      emAberto = true;
    } else {
      const dtPgto = new Date(String(pgtoVal).split("T")[0] + "T00:00:00");
      if (isNaN(dtPgto) || dtPgto > corte) {
        emAberto = true;
      }
    }

    if (!emAberto) continue;

    const valor = Number(r[entradaKey] || 0);
    porCedente[cliente] = (porCedente[cliente] || 0) + valor;
  }

  const total = Object.values(porCedente).reduce((acc, v) => acc + Number(v || 0), 0);

  return {
    dataCorte: corte.toISOString().split("T")[0],
    porCedente,
    total,
  };
}

function calcularCreditoEmAbertoCedentesExcluidosSerie(rows) {
  if (!rows || rows.length === 0) return [];

  const firstRow = rows[0];
  const emisKey = Object.keys(firstRow).find(
    (k) => k.toLowerCase().includes("emis")
  );

  if (!emisKey) {
    console.log("Não achei a chave de emissão.");
    return [];
  }

  const emisDates = rows
    .map((r) => r[emisKey])
    .filter(Boolean)
    .map((d) => new Date(String(d).split("T")[0] + "T00:00:00"))
    .filter((d) => !isNaN(d));

  if (emisDates.length === 0) return [];

  const minDate = new Date(Math.min(...emisDates));
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const resultado = [];

  let ano = minDate.getFullYear();
  let mes = minDate.getMonth();

  while (ano < hoje.getFullYear() || (ano === hoje.getFullYear() && mes <= hoje.getMonth())) {
    const corteMes = ultimoDiaUtilDoMes(ano, mes);
    const apuracaoMes = calcularCreditoEmAbertoCedentesExcluidosPorData(rows, corteMes);

    resultado.push({
      referencia: `${ano}-${String(mes + 1).padStart(2, "0")}`,
      tipo: "ultimo_dia_util_mes",
      ...apuracaoMes,
    });

    mes += 1;
    if (mes > 11) {
      mes = 0;
      ano += 1;
    }
  }

  const apuracaoHoje = calcularCreditoEmAbertoCedentesExcluidosPorData(rows, hoje);

  resultado.push({
    referencia: "hoje",
    tipo: "dia_atual",
    ...apuracaoHoje,
  });

  return resultado;
}

function imprimirCreditoEmAbertoCedentesExcluidos(serie) {
  if (!serie || serie.length === 0) {
    console.log("Nenhum dado de crédito em aberto dos cedentes ignorados.");
    return;
  }

  console.group("CRÉDITO EM ABERTO — CEDENTES IGNORADOS");

  const resumo = serie.map((item) => ({
    Referencia: item.referencia,
    Tipo: item.tipo,
    "Data Corte": item.dataCorte,
    Total: Number(item.total || 0),
  }));

  console.log("Resumo geral:");
  console.table(resumo);

  serie.forEach((item) => {
    const linhasCedentes = Object.entries(item.porCedente || {})
      .sort((a, b) => b[1] - a[1])
      .map(([cedente, valor]) => ({
        Cedente: cedente,
        "Crédito em Aberto": Number(valor || 0),
      }));

    console.groupCollapsed(
      `${item.referencia} | ${item.dataCorte} | Total: ${formatarMoeda(item.total || 0)}`
    );

    if (linhasCedentes.length === 0) {
      console.log("Sem crédito em aberto dos cedentes ignorados nesta data.");
    } else {
      console.table(linhasCedentes);
    }

    console.groupEnd();
  });

  console.groupEnd();
}

function cedenteValido(cedente) {
  if (!cedente) return false;
  return !CEDENTES_IGNORADOS.some((ignorado) =>
    String(cedente).trim().startsWith(ignorado)
  );
}

function calcularRiscoAtualIgualMicro(rows) {
  if (!rows || rows.length === 0) return 0;

  const firstRow = rows[0];
  const vctoKey = Object.keys(firstRow).find(
    (k) => k.toLowerCase() === "vcto" || (k.toLowerCase().includes("vcto") && !k.toLowerCase().includes("vl"))
  );
  const pgtoKey = Object.keys(firstRow).find(
    (k) => k.toLowerCase() === "pgto" || (k.toLowerCase().includes("pgto") && !k.toLowerCase().includes("vl"))
  );
  const statusKey = Object.keys(firstRow).find(
    (k) => k.toLowerCase() === "status" || k.toLowerCase() === "estado"
  );
  const entradaKey = Object.keys(firstRow).find(
    (k) => k.toLowerCase() === "entrada" || k.toLowerCase().includes("valor")
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let riscoAtual = 0;

  for (const r of rows) {
    if (!cedenteValido(r.Cliente)) continue;

    let status = "invalido";
    const vctoVal = vctoKey ? r[vctoKey] : null;
    const pgtoVal = pgtoKey ? r[pgtoKey] : null;
    const statusVal = statusKey ? String(r[statusKey] || "").trim().toUpperCase() : "";

    if (statusVal === "REC" || statusVal.includes("REC")) {
      status = "recompra";
    } else if (vctoVal) {
      const effectiveVcto = new Date(String(vctoVal).split("T")[0] + "T00:00:00");

      if (effectiveVcto.getDay() === 6) effectiveVcto.setDate(effectiveVcto.getDate() + 2);
      else if (effectiveVcto.getDay() === 0) effectiveVcto.setDate(effectiveVcto.getDate() + 1);

      if (pgtoVal && String(pgtoVal).trim() !== "") {
        const pgtoDate = new Date(String(pgtoVal).split("T")[0] + "T00:00:00");
        status = pgtoDate <= effectiveVcto ? "liquidado" : "liquidadoAtraso";
      } else {
        status = effectiveVcto < today ? "atraso" : "aVencer";
      }
    }

    if (status === "aVencer" || status === "atraso") {
      riscoAtual += Number(r[entradaKey] || 0);
    }
  }

  return riscoAtual;
}

const cardStyle = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: "12px",
  padding: "24px",
  boxShadow: "0 8px 20px rgba(0,0,0,0.06)",
};

const inputStyle = {
  width: "100%",
  padding: "12px",
  borderRadius: "8px",
  border: "1px solid #d1d5db",
  boxSizing: "border-box",
  fontSize: "14px",
  outline: "none",
  background: "#fff",
};

const SMART_TABLE = "secInfoSmart";
const SMART_BATCH_SIZE = 500;

const SMART_HEADER_ALIASES = {
  Cliente: ["Cedente", "Cliente"],
  "Dt.Emis": ["Data emissao", "Data emissão", "DATA EMISSÃO", "Dt.Emis"],
  Vcto: ["Vencimento", "Vcto"],
  Pgto: ["Data de quitação", "DATA DE QUITAÇÃO", "Pgto"],
  "Vl Pgto": ["Liquidado", "LIQUIDADO(R$)", "Vl Pgto"],
  Dcto: ["Documento", "Dcto"],
  "Borderô": ["OP", "Bordero", "Borderô"],
  Entrada: ["Total", "TOTAL(R$)", "Entrada"],
  Juros: ["JUROS(R$)", "Juros(R$)", "Juros"],
  Multa: ["MULTA(R$)", "Multa(R$)", "Multa"],
  Sacado: ["Sacado"],
  Status: ["Situação", "Status"],
  Desagio: ["Desagio", "Deságio"],
};

const normalizeSmartHeader = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();

const decodeSmartWorkbookText = (buffer) => {
  const decoders = ["windows-1252", "iso-8859-1", "utf-8"];
  for (const encoding of decoders) {
    try {
      const text = new TextDecoder(encoding).decode(buffer);
      if (/<\s*(html|table|!doctype)/i.test(text)) return text;
    } catch (err) {
      console.debug(`Falha ao decodificar arquivo Smart como ${encoding}`, err);
    }
  }
  return "";
};

const parseSmartHtmlWorkbook = (buffer) => {
  const html = decodeSmartWorkbookText(buffer);
  if (!html) return null;

  const document = new DOMParser().parseFromString(html, "text/html");
  const table = document.querySelector("table");
  if (!table) return null;

  return Array.from(table.querySelectorAll("tr"))
    .map((tr) =>
      Array.from(tr.querySelectorAll("th,td")).map((td) =>
        td.textContent.replace(/\s+/g, " ").trim()
      )
    )
    .filter((row) => row.some(Boolean));
};

const parseSmartBinaryWorkbook = (buffer) => {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
};

const findSmartHeaderRow = (rows) =>
  rows.findIndex((row) => {
    const normalized = row.map(normalizeSmartHeader);
    return (
      normalized.includes(normalizeSmartHeader("Documento")) &&
      (normalized.includes(normalizeSmartHeader("Cedente")) ||
        normalized.includes(normalizeSmartHeader("Cliente"))) &&
      (normalized.includes(normalizeSmartHeader("Sacado")) ||
        normalized.includes(normalizeSmartHeader("Vcto")))
    );
  });

const buildSmartSourceRow = (headers, row) =>
  headers.reduce((acc, header, index) => {
    const key = String(header || "").trim();
    if (key) acc[key] = row[index];
    return acc;
  }, {});

const getSmartValue = (row, aliases) => {
  const normalizedMap = Object.entries(row).reduce((acc, [key, value]) => {
    acc[normalizeSmartHeader(key)] = value;
    return acc;
  }, {});

  for (const alias of aliases) {
    const value = normalizedMap[normalizeSmartHeader(alias)];
    if (value !== undefined && value !== "") return value;
  }
  return null;
};

const mapSmartRow = (row, index) => {
  const bordero = cleanNumber(getSmartValue(row, SMART_HEADER_ALIASES["Borderô"]));
  const juros = cleanNumber(getSmartValue(row, SMART_HEADER_ALIASES.Juros)) || 0;
  const multa = cleanNumber(getSmartValue(row, SMART_HEADER_ALIASES.Multa)) || 0;

  return {
    Cliente: getSmartValue(row, SMART_HEADER_ALIASES.Cliente),
    "Dt.Emis": cleanDate(getSmartValue(row, SMART_HEADER_ALIASES["Dt.Emis"])),
    Vcto: cleanDate(getSmartValue(row, SMART_HEADER_ALIASES.Vcto)),
    Pgto: cleanDate(getSmartValue(row, SMART_HEADER_ALIASES.Pgto)),
    "Vl Pgto": cleanNumber(getSmartValue(row, SMART_HEADER_ALIASES["Vl Pgto"])),
    Dcto: getSmartValue(row, SMART_HEADER_ALIASES.Dcto),
    "Cód.Red": index + 1,
    "Borderô": bordero,
    Entrada: cleanNumber(getSmartValue(row, SMART_HEADER_ALIASES.Entrada)),
    "Juros e Multa": juros + multa,
    Sacado: getSmartValue(row, SMART_HEADER_ALIASES.Sacado),
    Status: getSmartValue(row, SMART_HEADER_ALIASES.Status),
    Estado: "A confirmar",
    Desagio: cleanNumber(getSmartValue(row, SMART_HEADER_ALIASES.Desagio)),
    "Tx.Efet": null,
  };
};

const isUsefulSmartRow = (row) =>
  Number.isFinite(row["Borderô"]) &&
  Boolean(row.Dcto || row.Cliente || row.Sacado || row.Entrada);

const parseSmartIsoDate = (value) => {
  if (!value) return null;
  const parts = String(value).split("T")[0].split("-");
  if (parts.length !== 3) return null;
  const [year, month, day] = parts.map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
};

const isWeekend = (date) => date.getDay() === 0 || date.getDay() === 6;

const adjustToNextBusinessDay = (date) => {
  const adjusted = new Date(date);
  if (adjusted.getDay() === 6) adjusted.setDate(adjusted.getDate() + 2);
  if (adjusted.getDay() === 0) adjusted.setDate(adjusted.getDate() + 1);
  return adjusted;
};

const addBusinessDays = (date, daysToAdd) => {
  const result = new Date(date);
  let added = 0;
  while (added < daysToAdd) {
    result.setDate(result.getDate() + 1);
    if (!isWeekend(result)) added += 1;
  }
  return result;
};

const diffCalendarDays = (startDate, endDate) => {
  const startUtc = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const endUtc = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  return Math.round((endUtc - startUtc) / 86400000);
};

const getSmartPrazoTotal = (row) => {
  const dataBase = parseSmartIsoDate(row["Dt.Emis"]);
  const vencimento = parseSmartIsoDate(row.Vcto);
  if (!dataBase || !vencimento) return null;

  const vencimentoAjustado = adjustToNextBusinessDay(vencimento);
  const dataFinal = addBusinessDays(vencimentoAjustado, 2);
  const prazo = diffCalendarDays(dataBase, dataFinal);

  return prazo > 0 ? prazo : null;
};

const applySmartEffectiveRates = (rows) => {
  const grouped = {};

  rows.forEach((row) => {
    const key = limpaChave(row["Borderô"]);
    if (!key) return;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(row);
  });

  Object.values(grouped).forEach((group) => {
    let totalDescontado = 0;
    let totalDesagio = 0;
    let weightedPrazo = 0;

    group.forEach((row) => {
      const valorFace = cleanNumber(row.Entrada) || 0;
      const desagio = cleanNumber(row.Desagio) || 0;
      const valorDescontado = valorFace - desagio;
      const prazo = getSmartPrazoTotal(row);

      if (valorDescontado > 0 && prazo) {
        totalDescontado += valorDescontado;
        totalDesagio += desagio;
        weightedPrazo += valorDescontado * prazo;
      }
    });

    const prazoMedio = totalDescontado > 0 ? weightedPrazo / totalDescontado : null;
    const txEfetiva = totalDescontado > 0 && prazoMedio > 0
      ? (Math.pow(1 + totalDesagio / totalDescontado, 30 / prazoMedio) - 1) * 100
      : null;

    group.forEach((row) => {
      row["Tx.Efet"] = txEfetiva === null ? null : Number(txEfetiva.toFixed(6));
    });
  });

  return rows;
};

const smartKey = (row) =>
  `${limpaChave(row.Dcto)}__${limpaChave(row["Borderô"])}__${limpaChave(row.Vcto)}`;

const withoutSmartCodRed = (row) => {
  const copy = { ...row };
  delete copy["Cód.Red"];
  return copy;
};

const parseUniqueViolation = (error) => {
  const raw = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" | ");

  const keyMatch = raw.match(/Key \(([^)]+)\)=\(([^)]+)\)/i);
  const constraintMatch = raw.match(/unique constraint "([^"]+)"/i);

  return {
    isUniqueViolation:
      error?.code === "23505" ||
      /duplicate key|violates unique constraint/i.test(raw),
    constraint: constraintMatch?.[1] || "constraint unique não informada",
    columns: keyMatch?.[1] || "colunas não informadas",
    values: keyMatch?.[2] || "valores não informados",
    raw,
  };
};

const logSmartUniqueViolation = (error, rows, action) => {
  const info = parseUniqueViolation(error);
  if (!info.isUniqueViolation) return null;

  const possibleRows = rows.filter((row) => {
    const columns = info.columns
      .split(",")
      .map((column) => column.replace(/"/g, "").trim());
    const values = info.values.split(",").map((value) => value.trim());

    return columns.every((column, index) =>
      limpaChave(row[column]) === limpaChave(values[index])
    );
  });

  console.group(`Violação unique Smart (${action})`);
  console.log("Constraint:", info.constraint);
  console.log("Colunas:", info.columns);
  console.log("Valores:", info.values);
  console.log("Erro completo:", error);
  console.table(possibleRows.length > 0 ? possibleRows : rows);
  console.groupEnd();

  return `Violação unique em ${info.constraint}: (${info.columns})=(${info.values})`;
};

export default function UploadData() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState("");
  const [smartFiles, setSmartFiles] = useState([]);
  const [smartLoading, setSmartLoading] = useState(false);
  const [smartStatus, setSmartStatus] = useState("");
  const [smartProgress, setSmartProgress] = useState("");

  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotStatus, setSnapshotStatus] = useState("");
  const [snapshotRiscoAtual, setSnapshotRiscoAtual] = useState(0);
  const [snapshotLastUpdated, setSnapshotLastUpdated] = useState("");
  const [dinheiroBanco, setDinheiroBanco] = useState("");
  const [compraDebentures, setCompraDebentures] = useState("0");

  const [snapshotHistorico, setSnapshotHistorico] = useState([]);
  const [snapshotHistoricoLoading, setSnapshotHistoricoLoading] = useState(false);

  const [exportOpenLoading, setExportOpenLoading] = useState(false);

  const snapshotDate = useMemo(() => getTodayIso(), []);

  const readFileAsArrayBuffer = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(new Uint8Array(e.target.result));
      reader.onerror = (e) => reject(e);
      reader.readAsArrayBuffer(file);
    });
  };

  const readSmartRows = async (file) => {
    const buffer = await file.arrayBuffer();
    const rows = parseSmartHtmlWorkbook(buffer) || parseSmartBinaryWorkbook(buffer);
    const headerIndex = findSmartHeaderRow(rows);

    if (headerIndex < 0) {
      throw new Error("Não encontrei a linha de cabeçalho no arquivo Smart.");
    }

    const headers = rows[headerIndex];
    return rows
      .slice(headerIndex + 1)
      .map((row) => buildSmartSourceRow(headers, row))
      .map(mapSmartRow)
      .filter(isUsefulSmartRow);
  };

  const processSmartFiles = async () => {
    if (smartFiles.length === 0) {
      setSmartStatus("❌ Selecione um ou mais arquivos Excel para atualizar a secInfoSmart.");
      return;
    }

    setSmartLoading(true);
    setSmartStatus("");
    setSmartProgress(`Processando ${smartFiles.length} arquivo(s)...`);

    try {
      const rowsByFile = await Promise.all(smartFiles.map(readSmartRows));
      const rowsByKey = new Map();

      rowsByFile.flat().forEach((row) => {
        rowsByKey.set(smartKey(row), row);
      });

      const smartRows = applySmartEffectiveRates(
        Array.from(rowsByKey.values()).map((row, index) => ({
          ...row,
          "Cód.Red": index + 1,
        }))
      );

      if (smartRows.length === 0) {
        throw new Error("Nenhuma linha válida encontrada nos arquivos Smart.");
      }

      const borderos = Array.from(new Set(smartRows.map((row) => row["Borderô"])));
      setSmartProgress(`Checando ${smartRows.length} registros em ${SMART_TABLE}...`);

      const { data: existingRows, error: existingError } = await supabase
        .from(SMART_TABLE)
        .select('id,Dcto,"Borderô",Vcto')
        .in('"Borderô"', borderos);

      if (existingError) {
        throw new Error(`Erro ao checar registros Smart: ${existingError.message}`);
      }

      const existingMap = {};
      (existingRows || []).forEach((row) => {
        existingMap[smartKey(row)] = row;
      });

      const rowsToInsert = [];
      const rowsToUpdate = [];

      smartRows.forEach((row) => {
        const existingRow = existingMap[smartKey(row)];
        if (existingRow?.id) {
          rowsToUpdate.push({ id: existingRow.id, row });
        } else {
          rowsToInsert.push(row);
        }
      });

      let insertedCount = 0;
      let updatedCount = 0;
      let rowsToInsertWithCodRed = [];

      if (rowsToInsert.length > 0) {
        const { data: lastCodRedRows, error: lastCodRedError } = await supabase
          .from(SMART_TABLE)
          .select('"Cód.Red"')
          .order('"Cód.Red"', { ascending: false })
          .limit(1);

        if (lastCodRedError) {
          throw new Error(`Erro ao buscar próximo Cód.Red Smart: ${lastCodRedError.message}`);
        }

        const lastCodRed = cleanNumber(lastCodRedRows?.[0]?.["Cód.Red"]) || 0;
        rowsToInsertWithCodRed = rowsToInsert.map((row, index) => ({
          ...row,
          "Cód.Red": lastCodRed + index + 1,
        }));
      }

      for (let i = 0; i < rowsToInsertWithCodRed.length; i += SMART_BATCH_SIZE) {
        const batch = rowsToInsertWithCodRed.slice(i, i + SMART_BATCH_SIZE);
        const { error } = await supabase.from(SMART_TABLE).insert(batch);
        if (error) {
          const uniqueMessage = logSmartUniqueViolation(error, batch, "insert");
          throw new Error(uniqueMessage || `Erro ao inserir Smart: ${error.message}`);
        }

        insertedCount += batch.length;
        setSmartProgress(`Inserindo novos... ${insertedCount} / ${rowsToInsertWithCodRed.length}`);
      }

      for (let i = 0; i < rowsToUpdate.length; i += 1) {
        const item = rowsToUpdate[i];
        const { error } = await supabase
          .from(SMART_TABLE)
          .update(withoutSmartCodRed(item.row))
          .eq("id", item.id);

        if (error) {
          const uniqueMessage = logSmartUniqueViolation(error, [item.row], "update");
          throw new Error(uniqueMessage || `Erro ao atualizar Smart: ${error.message}`);
        }

        updatedCount += 1;
        if (updatedCount % 25 === 0 || updatedCount === rowsToUpdate.length) {
          setSmartProgress(`Atualizando existentes... ${updatedCount} / ${rowsToUpdate.length}`);
        }
      }

      setSmartStatus(`✅ secInfoSmart atualizada: ${insertedCount} novo(s), ${updatedCount} atualizado(s).`);
      setSmartProgress("");
      setSmartFiles([]);
      document.getElementById("smart-upload-input").value = "";
    } catch (err) {
      setSmartStatus(`❌ Erro: ${err.message}`);
      setSmartProgress("");
      console.error(err);
    } finally {
      setSmartLoading(false);
    }
  };

  const carregarRiscoAtualSnapshot = async () => {
    setSnapshotStatus("");
    try {
      const { data, error } = await supabase.from("secInfo").select("*");
      if (error) throw error;

      const recebiveis = calcularRiscoAtualIgualMicro(data || []);
      setSnapshotRiscoAtual(recebiveis);
      setSnapshotLastUpdated(new Date().toLocaleString("pt-BR"));

      // const resultadoCedentesExcluidos =
      //   calcularCreditoEmAbertoCedentesExcluidosSerie(data || []);

      // imprimirCreditoEmAbertoCedentesExcluidos(resultadoCedentesExcluidos);

    } catch (err) {
      console.error(err);
      setSnapshotStatus(`❌ Não foi possível calcular o risco atual: ${err.message}`);
    }
  };

  useEffect(() => {
    carregarRiscoAtualSnapshot();
    carregarHistoricoSnapshots();
  }, []);

  const carregarHistoricoSnapshots = async () => {
    setSnapshotHistoricoLoading(true);
    try {
      const { data, error } = await supabase
        .from("secSnapshots")
        .select("*")
        .order("Data", { ascending: false });

      if (error) throw error;
      setSnapshotHistorico(data || []);
    } catch (err) {
      console.error(err);
      setSnapshotStatus(`❌ Não foi possível carregar o histórico de snapshots: ${err.message}`);
    } finally {
      setSnapshotHistoricoLoading(false);
    }
  };

  const criarSnapshot = async () => {
    const dinheiroBancoNum = cleanNumber(dinheiroBanco);
    const compraDebenturesNum = cleanNumber(compraDebentures) ?? 0;

    if (dinheiroBancoNum === null) {
      setSnapshotStatus("❌ Informe o valor de Dinheiro Banco.");
      return;
    }

    setSnapshotLoading(true);
    setSnapshotStatus("");

    try {
      const payload = {
        Data: snapshotDate,
        Recebiveis: Number(snapshotRiscoAtual || 0),
        "Dinheiro Banco": dinheiroBancoNum,
        "Compra Debentures": compraDebenturesNum,
      };

      const { error } = await supabase.from("secSnapshots").insert(payload);
      if (error) throw error;

      setSnapshotStatus("✅ Snapshot criado com sucesso!");
      setDinheiroBanco("");
      setCompraDebentures("0");
      await carregarRiscoAtualSnapshot();
      await carregarHistoricoSnapshots();
    } catch (err) {
      console.error(err);
      setSnapshotStatus(`❌ Erro ao criar snapshot: ${err.message}`);
    } finally {
      setSnapshotLoading(false);
    }
  };

const exportarCreditoEmAberto = async () => {
  setExportOpenLoading(true);
  setSnapshotStatus("");

  try {
    const { data, error } = await supabase.from("secInfo").select("*");
    if (error) throw error;

    const rows = data || [];
    if (rows.length === 0) {
      throw new Error("Nenhum registro encontrado na tabela secInfo.");
    }

    const firstRow = rows[0];

    const emisKey = Object.keys(firstRow).find(
      (k) => k.toLowerCase().includes("emis")
    );
    const vctoKey = Object.keys(firstRow).find(
      (k) =>
        k.toLowerCase() === "vcto" ||
        (k.toLowerCase().includes("vcto") && !k.toLowerCase().includes("vl"))
    );
    const pgtoKey = Object.keys(firstRow).find(
      (k) =>
        k.toLowerCase() === "pgto" ||
        (k.toLowerCase().includes("pgto") && !k.toLowerCase().includes("vl"))
    );
    const statusKey = Object.keys(firstRow).find(
      (k) => k.toLowerCase() === "status" || k.toLowerCase() === "estado"
    );
    const entradaKey = Object.keys(firstRow).find(
      (k) => k.toLowerCase() === "entrada" || k.toLowerCase().includes("valor")
    );

    if (!vctoKey || !entradaKey) {
      throw new Error("Não encontrei as colunas de vencimento e valor de face.");
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const titulosEmAberto = rows
      .filter((r) => {
        const statusVal = statusKey
          ? String(r[statusKey] || "").trim().toUpperCase()
          : "";
        if (statusVal === "REC" || statusVal.includes("REC")) return false;

        const pgtoVal = pgtoKey ? r[pgtoKey] : null;
        if (pgtoVal && String(pgtoVal).trim() !== "") return false;

        const vctoVal = r[vctoKey];
        if (!vctoVal) return false;

        const effectiveVcto = new Date(
          String(vctoVal).split("T")[0] + "T00:00:00"
        );
        if (isNaN(effectiveVcto)) return false;

        if (effectiveVcto.getDay() === 6) effectiveVcto.setDate(effectiveVcto.getDate() + 2);
        else if (effectiveVcto.getDay() === 0) effectiveVcto.setDate(effectiveVcto.getDate() + 1);

        return true;
      })
      .map((r) => {
        const vctoOriginal = r[vctoKey];
        const effectiveVcto = new Date(
          String(vctoOriginal).split("T")[0] + "T00:00:00"
        );

        if (effectiveVcto.getDay() === 6) effectiveVcto.setDate(effectiveVcto.getDate() + 2);
        else if (effectiveVcto.getDay() === 0) effectiveVcto.setDate(effectiveVcto.getDate() + 1);

        const situacao = effectiveVcto < today ? "Vencido" : "A vencer";
        const valorFace = Number(r[entradaKey] || 0);
        const cedente = String(r["Cliente"] || "").trim();
        const excluido = !cedenteValido(cedente);

        return {
          Cedente: cedente,
          Sacado: r["Sacado"] || "",
          "Data de Emissão": formatDateBR(emisKey ? r[emisKey] : ""),
          "Data de Vencimento": formatDateBR(vctoOriginal),
          "Valor de Face": valorFace,
          Dcto: r["Dcto"] || "",
          Bordero: r["Borderô"] || "",
          "Tx Efet": r["Tx.Efet"] ?? "",
          Situação: situacao,
          "Cód.Red": r["Cód.Red"] || "",
          "Vl Pgto": cleanNumber(r["Vl Pgto"]) || "",
          Pgto: formatDateBR(pgtoKey ? r[pgtoKey] : ""),
          Status: statusKey ? (r[statusKey] || "") : "",
          Observação: "",
          _excluido: excluido,
          _qtdLinhasAgrupadas: Number(r["Qtd Linhas Agrupadas"] || 1),
          _detalhesAgrupamento: r["Detalhes Agrupamento"] || "",
        };
      });

    const titulosPrincipais = titulosEmAberto
      .filter((item) => !item._excluido)
      .sort((a, b) => {
        const da = a["Data de Vencimento"].split("/").reverse().join("-");
        const db = b["Data de Vencimento"].split("/").reverse().join("-");
        return da.localeCompare(db);
      });

    const titulosExcluidos = titulosEmAberto
      .filter((item) => item._excluido)
      .sort((a, b) => {
        const da = a["Data de Vencimento"].split("/").reverse().join("-");
        const db = b["Data de Vencimento"].split("/").reverse().join("-");
        return da.localeCompare(db);
      });

    if (titulosPrincipais.length === 0 && titulosExcluidos.length === 0) {
      throw new Error("Nenhum título em aberto encontrado.");
    }

    const somaPrincipal = titulosPrincipais.reduce(
      (acc, item) => acc + Number(item["Valor de Face"] || 0),
      0
    );

    const somaExcluidos = titulosExcluidos.reduce(
      (acc, item) => acc + Number(item["Valor de Face"] || 0),
      0
    );

    const principalParaExportar = [
      ...titulosPrincipais.map(
        ({
          _excluido,
          _qtdLinhasAgrupadas,
          _detalhesAgrupamento,
          ...rest
        }) => rest
      ),
      {
        Cedente: "TOTAL",
        Sacado: `${titulosPrincipais.length} título(s)`,
        "Data de Emissão": "",
        "Data de Vencimento": "",
        "Valor de Face": somaPrincipal,
        Dcto: "",
        Bordero: "",
        "Tx Efet": "",
        Situação: "",
        "Cód.Red": "",
        "Vl Pgto": "",
        Pgto: "",
        Status: "",
        Observação: "",
      },
    ];

    const excluidosParaExportar = [];

    titulosExcluidos.forEach((item) => {
      const {
        _excluido,
        _qtdLinhasAgrupadas,
        _detalhesAgrupamento,
        ...baseRow
      } = item;

      excluidosParaExportar.push({
        ...baseRow,
        Observação:
          _qtdLinhasAgrupadas > 1
            ? `Linha consolidada por Cliente + Dcto (${_qtdLinhasAgrupadas} linhas somadas)`
            : "",
      });

      if (_qtdLinhasAgrupadas > 1 && _detalhesAgrupamento) {
        let detalhes = [];
        try {
          detalhes = JSON.parse(_detalhesAgrupamento);
        } catch (e) {
          detalhes = [];
        }

        detalhes.forEach((det, idx) => {
          excluidosParaExportar.push({
            Cedente: `→ DETALHE ${idx + 1}`,
            Sacado: det["Sacado"] || "",
            "Data de Emissão": formatDateBR(det["Dt.Emis"] || ""),
            "Data de Vencimento": formatDateBR(det["Vcto"] || ""),
            "Valor de Face": Number(det["Entrada"] || 0),
            Dcto: det["Dcto"] || "",
            Bordero: det["Borderô"] || "",
            "Tx Efet": det["Tx.Efet"] ?? "",
            Situação: "Detalhe do agrupamento",
            "Cód.Red": det["Cód.Red"] || "",
            "Vl Pgto": cleanNumber(det["Vl Pgto"]) || "",
            Pgto: formatDateBR(det["Pgto"] || ""),
            Status: det["Status"] || det["Estado"] || "",
            Observação: "Linha original usada na soma",
          });
        });
      }
    });

    excluidosParaExportar.push({
      Cedente: "TOTAL EXCLUÍDOS",
      Sacado: `${titulosExcluidos.length} título(s)`,
      "Data de Emissão": "",
      "Data de Vencimento": "",
      "Valor de Face": somaExcluidos,
      Dcto: "",
      Bordero: "",
      "Tx Efet": "",
      Situação: "",
      "Cód.Red": "",
      "Vl Pgto": "",
      Pgto: "",
      Status: "",
      Observação: "",
    });

    const criarSheet = (dados) => {
      const ws = XLSX.utils.json_to_sheet(dados);

      const range = XLSX.utils.decode_range(ws["!ref"]);
      for (let row = 1; row <= range.e.r + 1; row++) {
        const valorCell = XLSX.utils.encode_cell({ r: row, c: 4 });
        if (ws[valorCell]) ws[valorCell].z = '"R$" #,##0.00';

        const txCell = XLSX.utils.encode_cell({ r: row, c: 7 });
        if (ws[txCell] && typeof ws[txCell].v === "number") {
          ws[txCell].z = "0.00";
        }

        const vlPgtoCell = XLSX.utils.encode_cell({ r: row, c: 10 });
        if (ws[vlPgtoCell] && typeof ws[vlPgtoCell].v === "number") {
          ws[vlPgtoCell].z = '"R$" #,##0.00';
        }
      }

      ws["!cols"] = [
        { wch: 28 }, // Cedente
        { wch: 35 }, // Sacado
        { wch: 16 }, // Data Emissão
        { wch: 18 }, // Data Vencimento
        { wch: 18 }, // Valor de Face
        { wch: 16 }, // Dcto
        { wch: 14 }, // Bordero
        { wch: 12 }, // Tx Efet
        { wch: 20 }, // Situação
        { wch: 14 }, // Cód.Red
        { wch: 16 }, // Vl Pgto
        { wch: 14 }, // Pgto
        { wch: 14 }, // Status
        { wch: 42 }, // Observação
      ];

      return ws;
    };

    const wb = XLSX.utils.book_new();

    const wsPrincipal = criarSheet(principalParaExportar);
    XLSX.utils.book_append_sheet(wb, wsPrincipal, "Crédito em Aberto");

    if (titulosExcluidos.length > 0) {
      const wsExcluidos = criarSheet(excluidosParaExportar);
      XLSX.utils.book_append_sheet(wb, wsExcluidos, "Cedentes Excluídos");
    }

    const nomeArquivo = `credito_em_aberto_${getTodayIso()}.xlsx`;
    XLSX.writeFile(wb, nomeArquivo);

    setSnapshotStatus(
      `✅ Excel exportado com sucesso! Principal: ${titulosPrincipais.length} título(s) | ${formatarMoeda(somaPrincipal)}${
        titulosExcluidos.length > 0
          ? ` | Excluídos: ${titulosExcluidos.length} título(s) | ${formatarMoeda(somaExcluidos)}`
          : ""
      }`
    );
  } catch (err) {
    console.error(err);
    setSnapshotStatus(`❌ Erro ao exportar crédito em aberto: ${err.message}`);
  } finally {
    setExportOpenLoading(false);
  }
};

// const imprimirAuditoriaUpload = (auditoria) => {
//   console.group("AUDITORIA DO UPLOAD — SOMENTE EXCLUÍDOS");

//   const totalExcluido =
//     auditoria.semCodRed.length +
//     auditoria.clienteNumeroDeItens.length +
//     auditoria.excluidasSacadoPlaceholder.length +
//     auditoria.excluidasCodRedDuplicado.length;

//   console.log("Resumo dos excluídos:", {
//     semCodRed: auditoria.semCodRed.length,
//     clienteNumeroDeItens: auditoria.clienteNumeroDeItens.length,
//     excluidasSacadoPlaceholder: auditoria.excluidasSacadoPlaceholder.length,
//     excluidasCodRedDuplicado: auditoria.excluidasCodRedDuplicado.length,
//     totalExcluido,
//   });

//   if (auditoria.semCodRed.length) {
//     console.groupCollapsed(`Sem Cód.Red (${auditoria.semCodRed.length})`);
//     console.table(auditoria.semCodRed);
//     console.groupEnd();
//   }

//   if (auditoria.clienteNumeroDeItens.length) {
//     console.groupCollapsed(`Cliente = Número de Itens (${auditoria.clienteNumeroDeItens.length})`);
//     console.table(auditoria.clienteNumeroDeItens);
//     console.groupEnd();
//   }

//   if (auditoria.excluidasSacadoPlaceholder.length) {
//     console.groupCollapsed(`Excluídas por Sacado placeholder (${auditoria.excluidasSacadoPlaceholder.length})`);
//     console.table(auditoria.excluidasSacadoPlaceholder);
//     console.groupEnd();
//   }

//   if (auditoria.excluidasCodRedDuplicado.length) {
//     console.groupCollapsed(`Excluídas por Cód.Red duplicado (${auditoria.excluidasCodRedDuplicado.length})`);
//     console.table(auditoria.excluidasCodRedDuplicado);
//     console.groupEnd();
//   }

//   console.groupEnd();
// };

  const processAllFiles = async () => {
    if (files.length === 0) {
      setStatus("❌ Por favor, selecione os arquivos primeiro.");
      return;
    }

    setLoading(true);
    setStatus("");
    setProgress("1/5: Lendo e classificando arquivos...");

    try {
      const ratesFiles = [];
      const mainFiles = [];

      for (let file of files) {
        const data = await readFileAsArrayBuffer(file);
        const workbook = XLSX.read(data, { type: "array", cellDates: true });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawArray = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });

        let isRates = false;
        for (let r = 0; r < Math.min(rawArray.length, 50); r++) {
          const rowTxt = rawArray[r].map(x => String(x || "").trim().toLowerCase()).join(" ");
          if (rowTxt.includes("border") && (rowTxt.includes("vlr") || rowTxt.includes("face")) && (rowTxt.includes("des") || rowTxt.includes("deságio"))) {
            isRates = true;
            break;
          }
        }

        if (isRates) ratesFiles.push({ name: file.name, rawArray });
        else mainFiles.push({ name: file.name, worksheet });
      }

      console.log(`Arquivos de Taxas: ${ratesFiles.length} | Principais: ${mainFiles.length}`);
      setProgress("2/5: Extraindo mapa de taxas...");

      let globalRatesMap = {};
      for (let rf of ratesFiles) {
        const raw = rf.rawArray;
        let hdrR = -1;

        for (let r = 0; r < raw.length; r++) {
          const rowTxt = raw[r].map(x => String(x || "").trim().toLowerCase()).join(" ");
          if (rowTxt.includes("border") && (rowTxt.includes("vlr") || rowTxt.includes("face")) && (rowTxt.includes("des") || rowTxt.includes("deságio"))) {
            hdrR = r;
            break;
          }
        }

        if (hdrR !== -1) {
          const hdr = raw[hdrR].map(x => String(x || "").trim().toLowerCase());
          const cBordero = hdr.findIndex(h => h.includes("border"));
          let cDes = hdr.findIndex(h => h.includes("deságio"));
          if (cDes === -1) cDes = hdr.findIndex(h => h.includes("des"));
          const cTxEfet = hdr.findIndex(h => h.includes("tx.efet"));

          if (cBordero !== -1 && cDes !== -1 && cTxEfet !== -1) {
            let lastSeenBordero = null;
            for (let r = hdrR + 1; r < raw.length; r++) {
              const rowVals = raw[r];
              let currentBNum = null;

              const bVal = parseFloat(String(rowVals[cBordero] || "").trim());
              if (!isNaN(bVal) && Number.isInteger(bVal) && bVal > 0) currentBNum = bVal;
              else {
                for (let v of rowVals) {
                  if (v === null) continue;
                  const vFloat = parseFloat(String(v).trim());
                  if (!isNaN(vFloat) && Number.isInteger(vFloat) && vFloat > 0) {
                    currentBNum = vFloat;
                    break;
                  }
                }
              }

              if (currentBNum !== null) lastSeenBordero = currentBNum;
              const desVal = cleanNumber(rowVals[cDes]);
              const txVal = cleanNumber(rowVals[cTxEfet]);

              if (desVal === null && txVal === null) continue;
              if (lastSeenBordero !== null) {
                globalRatesMap[lastSeenBordero] = { Desagio: desVal, "Tx.Efet": txVal };
              }
            }
          }
        }
      }

      if (mainFiles.length === 0 && Object.keys(globalRatesMap).length > 0) {
        const borderos = Object.keys(globalRatesMap).map(Number);
        setProgress(`3/5: Modo Taxa — buscando registros para ${borderos.length} borderô(s) no banco...`);

        const { data: existingRows, error: fetchErr } = await supabase
          .from("secInfo")
          .select("*")
          .in('"Borderô"', borderos);

        if (fetchErr) throw new Error(`Erro ao buscar registros no banco: ${fetchErr.message}`);
        if (!existingRows || existingRows.length === 0) {
          throw new Error("Nenhum registro encontrado no banco para os borderôs informados.");
        }

        setProgress(`4/5: Atualizando taxas em ${existingRows.length} registro(s)...`);

        const updatedRows = existingRows.map((row) => ({
          ...row,
          Desagio: globalRatesMap[row["Borderô"]]?.Desagio ?? row.Desagio,
          "Tx.Efet": globalRatesMap[row["Borderô"]]?.["Tx.Efet"] ?? row["Tx.Efet"],
        }));

        const BATCH_SIZE = 500;
        let updatedCount = 0;
        for (let i = 0; i < updatedRows.length; i += BATCH_SIZE) {
          const batch = updatedRows.slice(i, i + BATCH_SIZE);
          const { error } = await supabase
            .from("secInfo")
            .upsert(batch, { onConflict: '"Cód.Red"' });
          if (error) throw new Error(`Erro ao atualizar taxas: ${error.message}`);
          updatedCount += batch.length;
          setProgress(`5/5: Atualizando... ${updatedCount} / ${updatedRows.length}`);
        }

        setStatus(`✅ Taxas atualizadas com sucesso em ${updatedRows.length} registro(s)!`);
        setProgress("");
        setFiles([]);
        document.getElementById("upload-input").value = "";
        await carregarRiscoAtualSnapshot();
        return;
      }

      setProgress("3/5: Processando planilhas principais...");

      if (mainFiles.length === 0) {
        throw new Error("Nenhum arquivo principal encontrado e nenhuma taxa extraída. Verifique os arquivos.");
      }

      let allExtractedRows = [];
const auditoria = {
  extraidasBrutas: [],
  semCodRed: [],
  clienteNumeroDeItens: [],
  duplicidadesDcto: [],
  excluidasSacadoPlaceholder: [],
  excluidasCodRedDuplicado: [],
  finalRows: [],
};

      for (let mf of mainFiles) {
        const rawData = XLSX.utils.sheet_to_json(mf.worksheet, { defval: null });
        rawData.forEach((row) => {
          const newRow = {};
          for (let key in row) {
            const cleanKey = String(key).trim();
            if (cleanKey.startsWith("__EMPTY") || cleanKey === "id" || cleanKey === "created_at") continue;
            let val = row[key];
            if (["Dt.Emis", "Vcto", "Pgto"].includes(cleanKey)) val = cleanDate(val);
            else if (["Vl Pgto", "Entrada", "Rec."].includes(cleanKey)) val = cleanNumber(val);
            else if (["Cód.Red", "Borderô"].includes(cleanKey)) {
              val = parseFloat(val);
              if (isNaN(val)) val = null;
            } else if (cleanKey === "UF" && val) {
              val = String(val).trim().toUpperCase().slice(0, 2);
            }
            newRow[cleanKey] = val;
          }

          if (newRow["Borderô"]) {
            const bNum = parseInt(newRow["Borderô"], 10);
            if (globalRatesMap[bNum]) {
              newRow["Desagio"] = globalRatesMap[bNum].Desagio;
              newRow["Tx.Efet"] = globalRatesMap[bNum]["Tx.Efet"];
            }
          }

const codRedLimpo = limpaChave(newRow["Cód.Red"]);
const clienteLimpo = String(newRow["Cliente"] || "").trim();

auditoria.extraidasBrutas.push({ ...newRow });

if (codRedLimpo === "") {
  auditoria.semCodRed.push({ ...newRow, motivoExclusao: "Sem Cód.Red" });
  return;
}

if (clienteLimpo === "Número de Itens") {
  auditoria.clienteNumeroDeItens.push({
    ...newRow,
    motivoExclusao: 'Cliente = "Número de Itens"',
  });
  return;
}

allExtractedRows.push(newRow);
        });
      }

      if (allExtractedRows.length === 0) throw new Error("Nenhuma linha extraída dos arquivos. Verifique as planilhas.");

      setProgress("4/5: Consolidando e limpando dados...");

      const groupedByDcto = {};
      allExtractedRows.forEach((r) => {
        const groupKey = `${limpaChave(r["Cliente"])}_${limpaChave(r["Dcto"])}`;
        if (!groupedByDcto[groupKey]) groupedByDcto[groupKey] = [];
        groupedByDcto[groupKey].push(r);
      });

const rowsAfterSum = [];
for (let key in groupedByDcto) {
  const group = groupedByDcto[key];

  if (group.length === 1) {
    rowsAfterSum.push({
      ...group[0],
      "Qtd Linhas Agrupadas": 1,
      "Detalhes Agrupamento": "",
    });
  } else {
    const sacadoEhPlaceholder = (valor) => {
      const s = String(valor || "").trim().replace(/\s/g, "");
      return s.startsWith("0-") || s === "0" || s === "";
    };

    auditoria.duplicidadesDcto.push({
  cliente: limpaChave(group[0]["Cliente"]),
  dcto: limpaChave(group[0]["Dcto"]),
  qtd: group.length,
  linhas: group.map((item) => ({ ...item })),
});

    let bestRow =
      group.find((r) => !sacadoEhPlaceholder(r["Sacado"])) || group[0];

    const totalPgto = group.reduce(
      (acc, curr) => acc + (cleanNumber(curr["Vl Pgto"]) || 0),
      0
    );

    const entradaBestRow = cleanNumber(bestRow["Entrada"]) || 0;

    const somaEntradasPlaceholder = group.reduce((acc, curr) => {
      if (curr === bestRow) return acc;

      if (sacadoEhPlaceholder(curr["Sacado"])) {
        return acc + (cleanNumber(curr["Entrada"]) || 0);
      }

      return acc;
    }, 0);

    const totalEntrada = entradaBestRow + somaEntradasPlaceholder;

    const detalhesAgrupamento = group.map((item) => {
      const detalhe = {};
      for (const k in item) {
        detalhe[k] = item[k] ?? "";
      }
      return detalhe;
    });

    rowsAfterSum.push({
      ...bestRow,
      "Vl Pgto": totalPgto,
      "Entrada": totalEntrada,
      "Qtd Linhas Agrupadas": group.length,
      "Detalhes Agrupamento": JSON.stringify(detalhesAgrupamento),
    });
  }
}

const finalRows = [];
const seenCodRed = new Set();

rowsAfterSum.forEach((r) => {
  const codRedVal = limpaChave(r["Cód.Red"]);
  if (!codRedVal) return;

  const sacadoStr = String(r["Sacado"] || "").trim().replace(/\s/g, "");
  const sacadoPlaceholder =
    sacadoStr.startsWith("0-") || sacadoStr === "0" || sacadoStr === "";

  if (sacadoPlaceholder) {
    auditoria.excluidasSacadoPlaceholder.push({
      ...r,
      motivoExclusao: "Sacado placeholder no filtro final",
    });
    return;
  }

  if (seenCodRed.has(codRedVal)) {
    auditoria.excluidasCodRedDuplicado.push({
      ...r,
      motivoExclusao: "Cód.Red duplicado no filtro final",
    });
    return;
  }

  seenCodRed.add(codRedVal);
  finalRows.push(r);
});

auditoria.finalRows = finalRows.map((item) => ({ ...item }));
// imprimirAuditoriaUpload(auditoria);

      setProgress(`5/5: Enviando ${finalRows.length} registros para o Supabase (Preservando taxas)...`);

      const BATCH_SIZE = 500;
      let upsertedCount = 0;

      for (let i = 0; i < finalRows.length; i += BATCH_SIZE) {
        const batch = finalRows.slice(i, i + BATCH_SIZE);
        const codReds = batch.map((r) => r["Cód.Red"]);

        const { data: existingData, error: fetchErr } = await supabase
          .from("secInfo")
          .select("*")
          .in('"Cód.Red"', codReds);

        if (fetchErr) throw new Error(`Erro ao checar banco: ${fetchErr.message}`);

        const existingMap = {};
        if (existingData) {
          existingData.forEach((r) => {
            existingMap[r["Cód.Red"]] = r;
          });
        }

        const finalBatch = batch.map((row) => {
          const existingRow = existingMap[row["Cód.Red"]];
          if (existingRow) {
            if (row["Desagio"] === null || row["Desagio"] === undefined) {
              row["Desagio"] = existingRow.Desagio;
            }
            if (row["Tx.Efet"] === null || row["Tx.Efet"] === undefined) {
              row["Tx.Efet"] = existingRow["Tx.Efet"];
            }
          }
          return row;
        });

        const { error } = await supabase
          .from("secInfo")
          .upsert(finalBatch, { onConflict: '"Cód.Red"' });

        if (error) throw new Error(`Erro no envio: ${error.message}`);

        upsertedCount += batch.length;
        setProgress(`Enviando... ${upsertedCount} / ${finalRows.length}`);
      }

      setStatus("✅ Banco de dados atualizado com sucesso!");
      setProgress("");
      setFiles([]);
      document.getElementById("upload-input").value = "";
      await carregarRiscoAtualSnapshot();
    } catch (err) {
      setStatus(`❌ Erro: ${err.message}`);
      setProgress("");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: "24px", maxWidth: "820px", margin: "0 auto" }}>
      <div style={cardStyle}>
        <h2 style={{ marginTop: 0, color: "#111827", fontSize: "20px" }}>Atualização de Dados</h2>
        <p style={{ color: "#6b7280", fontSize: "14px", marginBottom: "20px" }}>
          Selecione todos os arquivos de dados do Borderô e/ou dados de Taxas.
        </p>

        <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "8px", border: "1px solid #e2e8f0", marginBottom: "24px", fontSize: "13px", color: "#334155", lineHeight: "1.5" }}>
          <div style={{ marginBottom: "12px" }}>
            <strong style={{ color: "#0f172a", fontSize: "14px" }}>📄 Arquivo de Operações:</strong><br />
            Ir em Contas <span style={{ color: "#94a3b8", margin: "0 4px" }}>➔</span>
            Lançamentos <span style={{ color: "#94a3b8", margin: "0 4px" }}>➔</span>
            Busca Avançada <span style={{ color: "#94a3b8", margin: "0 4px" }}>➔</span>
            Vencimento = Todos ; a Receber ; OK <span style={{ color: "#94a3b8", margin: "0 4px" }}>➔</span>
            Imprimir (Primeiro Ícone) <span style={{ color: "#94a3b8", margin: "0 4px" }}>➔</span>
            Resumido - Modelo 2 <span style={{ color: "#94a3b8", margin: "0 4px" }}>➔</span>
            Exportar para Excel
          </div>
          <div>
            <strong style={{ color: "#0f172a", fontSize: "14px" }}>📊 Arquivo de Taxas (Método Muito Lento):</strong><br />
            Ir em Gerência <span style={{ color: "#94a3b8", margin: "0 4px" }}>➔</span>
            Operações <span style={{ color: "#94a3b8", margin: "0 4px" }}>➔</span>
            C. Própria <span style={{ color: "#94a3b8", margin: "0 4px" }}>➔</span>
            Aquisições no Período - Resumo <span style={{ color: "#94a3b8", margin: "0 4px" }}>➔</span>
            Seleciona APENAS Período Desejado (Método Muito Lento)<span style={{ color: "#94a3b8", margin: "0 4px" }}>➔</span>
            Exportar para Planilha do Excel (Penúltimo Ícone)
          </div>
        </div>

        <div style={{ marginBottom: "20px" }}>
          <input
            id="upload-input"
            type="file"
            multiple
            accept=".xlsx, .xls"
            onChange={(e) => setFiles(Array.from(e.target.files))}
            disabled={loading}
            style={{
              boxSizing: "border-box",
              width: "100%",
              padding: "12px",
              border: "2px dashed #cbd5e1",
              borderRadius: "8px",
              background: "#f8fafc",
              cursor: "pointer",
            }}
          />
          <div style={{ fontSize: "13px", color: "#64748b", marginTop: "8px", fontWeight: "500" }}>
            {files.length} arquivo(s) selecionado(s).
          </div>
        </div>

        <button
          onClick={processAllFiles}
          disabled={loading || files.length === 0}
          style={{
            boxSizing: "border-box",
            width: "100%",
            padding: "12px",
            borderRadius: "8px",
            border: "none",
            background: (loading || files.length === 0) ? "#9ca3af" : "#4f46e5",
            color: "#fff",
            fontWeight: "600",
            fontSize: "15px",
            cursor: (loading || files.length === 0) ? "not-allowed" : "pointer",
            transition: "background 0.2s",
          }}
        >
          {loading ? "Processando..." : "Processar e Enviar"}
        </button>

        {progress && (
          <div style={{ marginTop: "16px", fontSize: "14px", color: "#4f46e5", fontWeight: "600", textAlign: "center" }}>
            {progress}
          </div>
        )}

        {status && (
          <div style={{ marginTop: "16px", padding: "12px", borderRadius: "8px", background: status.includes("❌") ? "#fef2f2" : "#ecfdf5", color: status.includes("❌") ? "#991b1b" : "#065f46", fontWeight: "500", fontSize: "14px", textAlign: "center" }}>
            {status}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <h2 style={{ marginTop: 0, color: "#111827", fontSize: "20px" }}>Atualização Smart</h2>
        <p style={{ color: "#6b7280", fontSize: "14px", marginBottom: "20px" }}>
          Selecione um ou mais Excels de títulos para processar o novo layout e enviar para a tabela secInfoSmart.
        </p>

        <div style={{ background: "#f0fdfa", padding: "16px", borderRadius: "8px", border: "1px solid #99f6e4", marginBottom: "24px", fontSize: "13px", color: "#134e4a", lineHeight: "1.5" }}>
          O arquivo será convertido para as colunas Cliente, Dt.Emis, Vcto, Pgto, Vl Pgto, Dcto,
          Cód.Red, Borderô, Entrada, Juros e Multa, Sacado, Status, Estado, Desagio e Tx.Efet.
        </div>

        <div style={{ marginBottom: "20px" }}>
          <input
            id="smart-upload-input"
            type="file"
            multiple
            accept=".xlsx, .xls, .html"
            onChange={(e) => setSmartFiles(Array.from(e.target.files || []))}
            disabled={smartLoading}
            style={{
              boxSizing: "border-box",
              width: "100%",
              padding: "12px",
              border: "2px dashed #99f6e4",
              borderRadius: "8px",
              background: "#f0fdfa",
              cursor: "pointer",
            }}
          />
          <div style={{ fontSize: "13px", color: "#0f766e", marginTop: "8px", fontWeight: "600" }}>
            {smartFiles.length > 0
              ? `${smartFiles.length} arquivo(s) selecionado(s): ${smartFiles.map((file) => file.name).join(", ")}`
              : "Nenhum arquivo Smart selecionado."}
          </div>
        </div>

        <button
          onClick={processSmartFiles}
          disabled={smartLoading || smartFiles.length === 0}
          style={{
            boxSizing: "border-box",
            width: "100%",
            padding: "12px",
            borderRadius: "8px",
            border: "none",
            background: (smartLoading || smartFiles.length === 0) ? "#9ca3af" : "#0f766e",
            color: "#fff",
            fontWeight: "700",
            fontSize: "15px",
            cursor: (smartLoading || smartFiles.length === 0) ? "not-allowed" : "pointer",
            transition: "background 0.2s",
          }}
        >
          {smartLoading ? "Processando Smart..." : "Processar e Enviar Smart"}
        </button>

        {smartProgress && (
          <div style={{ marginTop: "16px", fontSize: "14px", color: "#0f766e", fontWeight: "700", textAlign: "center" }}>
            {smartProgress}
          </div>
        )}

        {smartStatus && (
          <div style={{ marginTop: "16px", padding: "12px", borderRadius: "8px", background: smartStatus.includes("❌") ? "#fef2f2" : "#ecfdf5", color: smartStatus.includes("❌") ? "#991b1b" : "#065f46", fontWeight: "500", fontSize: "14px", textAlign: "center" }}>
            {smartStatus}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ marginBottom: "20px" }}>
          <h2 style={{ margin: 0, color: "#111827", fontSize: "20px" }}>Criar Snapshot da Securitizadora</h2>
          <p style={{ color: "#6b7280", fontSize: "14px", margin: "8px 0 0 0" }}>
            Salva a foto do dia com recebíveis, dinheiro em banco e compra de debêntures.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", marginBottom: "20px" }}>
          <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "16px" }}>
            <div style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.04em", color: "#6b7280", fontWeight: 700, marginBottom: "8px" }}>Data</div>
            <div style={{ fontSize: "22px", fontWeight: 700, color: "#111827" }}>{snapshotDate.split("-").reverse().join("/")}</div>
          </div>
          <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "16px" }}>
            <div style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.04em", color: "#6b7280", fontWeight: 700, marginBottom: "8px" }}>Recebíveis</div>
            <div style={{ fontSize: "22px", fontWeight: 700, color: "#111827" }}>{formatarMoeda(snapshotRiscoAtual)}</div>
            <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "8px" }}>Baseado nos títulos em aberto</div>
          </div>
        </div>

        <div style={{ display: "grid", gap: "16px" }}>
          <div>
            <label style={{ display: "block", marginBottom: "6px", fontSize: "14px", fontWeight: 600, color: "#374151" }}>Dinheiro no Banco</label>
            <input
              type="text"
              value={dinheiroBanco}
              onChange={(e) => setDinheiroBanco(e.target.value)}
              placeholder="Ex.: 125000,50"
              style={inputStyle}
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: "6px", fontSize: "14px", fontWeight: 600, color: "#374151" }}>Debentures Adquiridas no Mês em R$</label>
            <input
              type="text"
              value={compraDebentures}
              onChange={(e) => setCompraDebentures(e.target.value)}
              placeholder="0"
              style={inputStyle}
            />
          </div>
        </div>

        <button
          onClick={criarSnapshot}
          disabled={snapshotLoading}
          style={{
            marginTop: "20px",
            width: "100%",
            padding: "12px",
            borderRadius: "8px",
            border: "none",
            background: snapshotLoading ? "#9ca3af" : "#16a34a",
            color: "#fff",
            fontWeight: 700,
            fontSize: "15px",
            cursor: snapshotLoading ? "not-allowed" : "pointer",
          }}
        >
          {snapshotLoading ? "Criando snapshot..." : "Criar Snapshot"}
        </button>

        <div style={{ marginTop: "24px" }}>
          <h3 style={{ margin: "0 0 12px 0", color: "#111827", fontSize: "16px" }}>
            Histórico de Snapshots
          </h3>

          <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: "10px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "620px", background: "#fff" }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th style={{ textAlign: "left", padding: "12px", fontSize: "13px", color: "#374151", borderBottom: "1px solid #e5e7eb" }}>Data</th>
                  <th style={{ textAlign: "right", padding: "12px", fontSize: "13px", color: "#374151", borderBottom: "1px solid #e5e7eb" }}>Recebíveis</th>
                  <th style={{ textAlign: "right", padding: "12px", fontSize: "13px", color: "#374151", borderBottom: "1px solid #e5e7eb" }}>Dinheiro no Banco</th>
                  <th style={{ textAlign: "right", padding: "12px", fontSize: "13px", color: "#374151", borderBottom: "1px solid #e5e7eb" }}>Deb. Adq. Mês</th>
                </tr>
              </thead>
              <tbody>
                {snapshotHistoricoLoading ? (
                  <tr>
                    <td colSpan="4" style={{ padding: "16px", textAlign: "center", color: "#6b7280" }}>
                      Carregando histórico...
                    </td>
                  </tr>
                ) : snapshotHistorico.length === 0 ? (
                  <tr>
                    <td colSpan="4" style={{ padding: "16px", textAlign: "center", color: "#6b7280" }}>
                      Nenhum snapshot encontrado.
                    </td>
                  </tr>
                ) : (
                  snapshotHistorico.map((item, idx) => (
                    <tr key={`${item.Data}-${idx}`} style={{ borderTop: idx === 0 ? "none" : "1px solid #f1f5f9" }}>
                      <td style={{ padding: "12px", fontSize: "14px", color: "#111827" }}>
                        {String(item["Data"] || "").split("-").reverse().join("/")}
                      </td>
                      <td style={{ padding: "12px", fontSize: "14px", color: "#111827", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {formatarMoeda(item["Recebiveis"])}
                      </td>
                      <td style={{ padding: "12px", fontSize: "14px", color: "#111827", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {formatarMoeda(item["Dinheiro Banco"])}
                      </td>
                      <td style={{ padding: "12px", fontSize: "14px", color: "#111827", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {formatarMoeda(item["Compra Debentures"])}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {snapshotLastUpdated && (
          <div style={{ marginTop: "12px", fontSize: "12px", color: "#6b7280", textAlign: "center" }}>
            Recebíveis recalculados em {snapshotLastUpdated}
          </div>
        )}

        {snapshotStatus && (
          <div style={{ marginTop: "16px", padding: "12px", borderRadius: "8px", background: snapshotStatus.includes("❌") ? "#fef2f2" : "#ecfdf5", color: snapshotStatus.includes("❌") ? "#991b1b" : "#065f46", fontWeight: "500", fontSize: "14px", textAlign: "center" }}>
            {snapshotStatus}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <h2 style={{ marginTop: 0, color: "#111827", fontSize: "20px" }}>
          Exportações
        </h2>
        <p style={{ color: "#6b7280", fontSize: "14px", marginBottom: "16px" }}>
          Exporta para Excel todo o crédito em aberto: títulos a vencer e vencidos sem liquidação.
        </p>

        <button
          onClick={exportarCreditoEmAberto}
          disabled={exportOpenLoading}
          style={{
            width: "100%",
            padding: "12px",
            borderRadius: "8px",
            border: "none",
            background: exportOpenLoading ? "#9ca3af" : "#2563eb",
            color: "#fff",
            fontWeight: 700,
            fontSize: "15px",
            cursor: exportOpenLoading ? "not-allowed" : "pointer",
          }}
        >
          {exportOpenLoading ? "Exportando crédito em aberto..." : "Exportar Crédito em Aberto"}
        </button>
      </div>
    </div>
  );
}
