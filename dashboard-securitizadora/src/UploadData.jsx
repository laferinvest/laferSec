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

const padDatePart = (value) => String(value || "").padStart(2, "0");

const expandYear = (value) => {
  const year = String(value || "").trim();
  if (year.length === 2) return Number(year) >= 70 ? `19${year}` : `20${year}`;
  return year;
};

const cleanDate = (val) => {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().split("T")[0];
  if (typeof val === "string" && val.includes("/")) {
    const parts = val.split("/").map((part) => part.trim());
    if (parts.length === 3) {
      const [day, month, year] = parts;
      return `${expandYear(year)}-${padDatePart(month)}-${padDatePart(day)}`;
    }
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

const normalizarTexto = (val) =>
  String(val || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const isStatusRecomprado = (status) => normalizarTexto(status) === "recomprado";

const getRowStatus = (row) =>
  row?.Status ??
  row?.["Situação"] ??
  row?.["SITUAÇÃO"] ??
  row?.Situacao ??
  row?.SITUACAO ??
  row?.Estado ??
  "";

const isStatusBaixado = (rowOrStatus) => {
  const status = typeof rowOrStatus === "object" ? getRowStatus(rowOrStatus) : rowOrStatus;
  const normalized = normalizarTexto(status);
  return (
    normalized.includes("baixad") ||
    normalized.includes("liquidad") ||
    normalized.includes("quitad")
  );
};

const isStatusAberto = (rowOrStatus) => {
  const status = typeof rowOrStatus === "object" ? getRowStatus(rowOrStatus) : rowOrStatus;
  const normalized = normalizarTexto(status);
  return (
    normalized.includes("abert") ||
    normalized === "a vencer" ||
    normalized.includes("vencido")
  );
};

const getRowPgto = (row) =>
  row?.Pgto ??
  row?.["Dt.Pgto"] ??
  row?.["Dt Pgto"] ??
  row?.["Data Pgto"] ??
  row?.["Data de Pgto"] ??
  row?.["Data de Pagamento"] ??
  row?.["Data de quitação"] ??
  row?.["DATA DE QUITAÇÃO"] ??
  "";

const hasRowPgto = (row) => Boolean(limpaChave(getRowPgto(row)));

const isInadimplente = (row) =>
  normalizarTexto(row?.inadimplencia ?? row?.Inadimplencia ?? row?.["Inadimplência"]) === "sim";

const normalizarChaveTexto = (val) =>
  normalizarTexto(val).replace(/[^a-z0-9]/g, "");

const isInadimplenciaColumn = (key) =>
  normalizarChaveTexto(key).startsWith("inadimplencia");

const isValorInadimplenciaPositivo = (value) => {
  const normalized = normalizarTexto(value);
  if (!normalized) return false;
  if (["nao", "n", "false", "0", "00/00/0000", "0000-00-00"].includes(normalized)) return false;
  return true;
};

const getInadimplenciaFromSource = (row) => {
  const statusText = Object.entries(row || {})
    .filter(([key]) => {
      const normalizedKey = normalizarChaveTexto(key);
      return normalizedKey === "situacao" || normalizedKey === "status";
    })
    .map(([, value]) => normalizarTexto(value))
    .join(" ");

  if (!statusText) return undefined;

  if (statusText.includes("inadimplente")) return "sim";

  return null;
};

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

    const ehExcluido = isInadimplente(r);
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
  return Boolean(cedente);
}

function registroValidoParaAnalise(row) {
  return cedenteValido(row?.Cliente) && !isInadimplente(row);
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
    if (!registroValidoParaAnalise(r)) continue;

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
  Entrada: ["Valor(R$)", "VALOR(R$)", "Valor", "Total", "TOTAL(R$)", "Entrada"],
  Juros: ["JUROS(R$)", "Juros(R$)", "Juros"],
  Multa: ["MULTA(R$)", "Multa(R$)", "Multa"],
  Sacado: ["Sacado"],
  Status: ["Situação", "SITUAÇÃO", "Status"],
  Desagio: ["Desagio", "Deságio", "DESÁGIO"],
  "Tx.Efet": ["Tx.Efet", "TX.EFET", "Tx Efet"],
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
    if (key) {
      let finalKey = key;
      let suffix = 1;
      while (Object.prototype.hasOwnProperty.call(acc, finalKey)) {
        finalKey = `${key}_${suffix}`;
        suffix += 1;
      }
      acc[finalKey] = row[index];
    }
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

const SECINFO_SOURCE_ALIASES = {
  Cliente: ["CEDENTE", "Cedente", "Cliente"],
  "Dt.Emis": ["DATA EMISSÃO", "Data emissao", "Data emissão", "Dt.Emis"],
  Vcto: ["VENCIMENTO", "Vencimento", "Vcto"],
  Pgto: ["DATA DE QUITAÇÃO", "Data de quitação", "Pgto"],
  "Vl Pgto": ["LIQUIDADO(R$)", "Liquidado", "Vl Pgto"],
  Dcto: ["DOCUMENTO", "Documento", "Dcto"],
  "Cód.Red": ["Cód.Red", "Cod.Red", "CÓD.RED"],
  "Borderô": ["OP", "Borderô", "Bordero"],
  Entrada: ["TOTAL(R$)", "TOTAL", "Total", "Entrada"],
  Sacado: ["SACADO", "Sacado"],
  Status: ["SITUAÇÃO", "Situação", "Status"],
  Desagio: ["DESÁGIO", "Deságio", "Desagio"],
  "Tx.Efet": ["Tx.Efet", "TX.EFET", "Tx Efet"],
};

const shouldMapSecInfoSourceRow = (row) => {
  const keys = Object.keys(row || {}).map(normalizeSmartHeader);
  return keys.includes(normalizeSmartHeader("DOCUMENTO")) &&
    keys.includes(normalizeSmartHeader("CEDENTE")) &&
    keys.includes(normalizeSmartHeader("SACADO"));
};

const mapSecInfoSourceRow = (row) => {
  const mapped = {
    Cliente: getSmartValue(row, SECINFO_SOURCE_ALIASES.Cliente),
    "Dt.Emis": cleanDate(getSmartValue(row, SECINFO_SOURCE_ALIASES["Dt.Emis"])),
    Vcto: cleanDate(getSmartValue(row, SECINFO_SOURCE_ALIASES.Vcto)),
    Pgto: cleanDate(getSmartValue(row, SECINFO_SOURCE_ALIASES.Pgto)),
    "Vl Pgto": cleanNumber(getSmartValue(row, SECINFO_SOURCE_ALIASES["Vl Pgto"])),
    Dcto: getSmartValue(row, SECINFO_SOURCE_ALIASES.Dcto),
    "Cód.Red": cleanNumber(getSmartValue(row, SECINFO_SOURCE_ALIASES["Cód.Red"])),
    "Borderô": cleanNumber(getSmartValue(row, SECINFO_SOURCE_ALIASES["Borderô"])),
    Entrada: cleanNumber(getSmartValue(row, SECINFO_SOURCE_ALIASES.Entrada)),
    Sacado: getSmartValue(row, SECINFO_SOURCE_ALIASES.Sacado),
    Status: getSmartValue(row, SECINFO_SOURCE_ALIASES.Status),
    Desagio: cleanNumber(getSmartValue(row, SECINFO_SOURCE_ALIASES.Desagio)),
    "Tx.Efet": cleanNumber(getSmartValue(row, SECINFO_SOURCE_ALIASES["Tx.Efet"])),
  };

  const inadimplencia = getInadimplenciaFromSource(row);
  if (inadimplencia !== undefined) mapped.inadimplencia = inadimplencia;
  return mapped;
};

const sourceRowsFromRawArray = (rawArray) => {
  const headerIndex = findSmartHeaderRow(rawArray);
  if (headerIndex < 0) return null;

  const headers = rawArray[headerIndex];
  return rawArray
    .slice(headerIndex + 1)
    .map((row) => buildSmartSourceRow(headers, row))
    .filter((row) => Object.values(row).some((value) => value !== null && value !== undefined && value !== ""));
};

const mapSmartRow = (row, index) => {
  const bordero = cleanNumber(getSmartValue(row, SMART_HEADER_ALIASES["Borderô"]));
  const juros = cleanNumber(getSmartValue(row, SMART_HEADER_ALIASES.Juros)) || 0;
  const multa = cleanNumber(getSmartValue(row, SMART_HEADER_ALIASES.Multa)) || 0;
  const inadimplencia = getInadimplenciaFromSource(row);

  const mapped = {
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
    "Tx.Efet": cleanNumber(getSmartValue(row, SMART_HEADER_ALIASES["Tx.Efet"])),
  };

  if (inadimplencia !== undefined) mapped.inadimplencia = inadimplencia;
  return mapped;
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

const secInfoKey = smartKey;

const entidadeDctoKey = (entidade, dcto) =>
  `${normalizarChaveTexto(entidade)}__${limpaChave(dcto)}`;

const clienteDctoKey = (row) => entidadeDctoKey(row?.Cliente, row?.Dcto);

const sacadoDctoKey = (row) => entidadeDctoKey(row?.Sacado, row?.Dcto);

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

const hasInadimplenciaValue = (row) =>
  Object.prototype.hasOwnProperty.call(row || {}, "inadimplencia");

const dctoBorderoKey = (row) =>
  `${limpaChave(row?.Dcto)}__${limpaChave(row?.["Borderô"])}`;

const dctoNormalizedBorderoKey = (row) =>
  `${normalizeDctoKey(row?.Dcto)}__${limpaChave(row?.["Borderô"])}`;

const dctoVctoKey = (row) =>
  `${limpaChave(row?.Dcto)}__${limpaChave(row?.Vcto)}`;

const normalizeDctoKey = (value) => {
  const normalized = normalizarChaveTexto(value);
  if (/^\d+$/.test(normalized)) return normalized.replace(/^0+/, "") || "0";
  return normalized;
};

const dateKeyVariants = (value) => {
  const variants = new Set();
  if (!value) return variants;

  const raw = String(value).trim().split("T")[0];
  if (!raw) return variants;

  variants.add(limpaChave(raw));

  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    variants.add(`${year}-${padDatePart(month)}-${padDatePart(day)}`);
  }

  const shortIsoMatch = raw.match(/^(\d{2})-(\d{1,2})-(\d{1,2})$/);
  if (shortIsoMatch) {
    const [, yearPart, month, day] = shortIsoMatch;
    variants.add(`${expandYear(yearPart)}-${padDatePart(month)}-${padDatePart(day)}`);
  }

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const [, first, second, yearPart] = slashMatch;
    const year = expandYear(yearPart);
    variants.add(`${year}-${padDatePart(second)}-${padDatePart(first)}`);
    variants.add(`${year}-${padDatePart(first)}-${padDatePart(second)}`);
  }

  return variants;
};

const hasDateIntersection = (left, right) => {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
};

const updateSecInfoInadimplenciaFromSmartRows = async (rows, setSmartProgress) => {
  const isWbaRow = (row) => cleanNumber(row?.Desagio) === 0;

  const sourceItems = rows
    .filter((row) =>
      isWbaRow(row) &&
      limpaChave(row.Dcto) &&
      limpaChave(row["Dt.Emis"]) &&
      limpaChave(row.Vcto)
    )
    .map((row) => ({
      row,
      isWba: true,
      dcto: limpaChave(row.Dcto),
      dctoNormalized: normalizeDctoKey(row.Dcto),
      emisVariants: dateKeyVariants(row["Dt.Emis"]),
      vctoVariants: dateKeyVariants(row.Vcto),
      nextValue: row.inadimplencia ?? null,
    }));

  if (sourceItems.length === 0) {
    return {
      updatedCount: 0,
      classifiedCount: 0,
      fetchedCount: 0,
      matchedCount: 0,
      fallbackMatchedCount: 0,
      changedCount: 0,
    };
  }

  const borderos = Array.from(
    new Set(
      sourceItems
        .map((item) => item.row["Borderô"])
        .filter((value) => value !== null && value !== undefined && value !== "")
    )
  );

  const vctos = Array.from(
    new Set(
      sourceItems
        .flatMap((item) => Array.from(item.vctoVariants))
        .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    )
  );

  const dctos = Array.from(
    new Set(
      sourceItems
        .map((item) => item.row.Dcto)
        .filter((value) => value !== null && value !== undefined && value !== "")
    )
  );

  setSmartProgress(`Atualizando dados WBA na secInfo para ${sourceItems.length} título(s)...`);

  const secInfoRowsById = new Map();

  const chunkArray = (arr, size = 250) => {
    const chunks = [];

    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }

    return chunks;
  };

  const fetchSecInfoCandidates = async (field, values, label) => {
    const cleanValues = Array.from(
      new Set(
        values
          .map((v) => (typeof v === "string" ? v.trim() : v))
          .filter((v) => v !== null && v !== undefined && v !== "")
      )
    );

    if (!cleanValues.length) return;

    for (const chunk of chunkArray(cleanValues, 250)) {
      const { data, error } = await supabase
        .from("secInfo")
        .select("*")
        .in(field, chunk);

      if (error) {
        console.error(`Erro Supabase ao buscar secInfo por ${label}`, {
          field,
          label,
          qtdValores: chunk.length,
          exemplos: chunk.slice(0, 20),
          error,
        });

        throw new Error(
          `Erro ao buscar títulos antigos na secInfo por ${label}: ${error.message}`
        );
      }

      (data || []).forEach((row) => {
        secInfoRowsById.set(row.id, row);
      });
    }
  };

  await fetchSecInfoCandidates('"Borderô"', borderos, "Borderô");
  await fetchSecInfoCandidates("Vcto", vctos, "Vcto");
  await fetchSecInfoCandidates("Dcto", dctos, "Dcto");

  const secInfoRows = Array.from(secInfoRowsById.values());

  const getIsoDateVariants = (value) =>
    Array.from(dateKeyVariants(value)).filter((variant) => /^\d{4}-\d{2}-\d{2}$/.test(variant));

  const makeMatchKeys = (rowOrItem, useNormalizedDcto = true, includeBordero = false) => {
    const row = rowOrItem?.row || rowOrItem;
    const dctoValue = useNormalizedDcto ? normalizeDctoKey(row?.Dcto) : limpaChave(row?.Dcto);
    const emisValues = getIsoDateVariants(row?.["Dt.Emis"]);
    const vctoValues = getIsoDateVariants(row?.Vcto);
    const borderoValue = limpaChave(row?.["Borderô"]);

    if (!dctoValue || emisValues.length === 0 || vctoValues.length === 0) return [];
    if (includeBordero && !borderoValue) return [];

    const keys = [];
    emisValues.forEach((emis) => {
      vctoValues.forEach((vcto) => {
        keys.push(
          includeBordero
            ? `${dctoValue}__${emis}__${vcto}__${borderoValue}`
            : `${dctoValue}__${emis}__${vcto}`
        );
      });
    });

    return keys;
  };

  const addToIndex = (index, key, item) => {
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(item);
  };

  const sourceIndex = {
    raw: new Map(),
    normalized: new Map(),
    rawBordero: new Map(),
    normalizedBordero: new Map(),
  };

  sourceItems.forEach((item) => {
    makeMatchKeys(item, false, false).forEach((key) => addToIndex(sourceIndex.raw, key, item));
    makeMatchKeys(item, true, false).forEach((key) => addToIndex(sourceIndex.normalized, key, item));
    makeMatchKeys(item, false, true).forEach((key) => addToIndex(sourceIndex.rawBordero, key, item));
    makeMatchKeys(item, true, true).forEach((key) => addToIndex(sourceIndex.normalizedBordero, key, item));
  });

  const getSourceEncargos = (sourceRow) => {
    const vlPgto = cleanNumber(sourceRow?.["Vl Pgto"]);
    const valorFace = cleanNumber(sourceRow?.Entrada);

    if (vlPgto === null || valorFace === null) return null;

    return Number((vlPgto - valorFace).toFixed(2));
  };

  const getSourceSignature = (item) => {
    const row = item.row;

    return JSON.stringify({
      inadimplencia: normalizarTexto(item.nextValue),
      status: normalizarTexto(row.Status),
      pgto: limpaChave(cleanDate(row.Pgto)),
      vlPgto: cleanNumber(row["Vl Pgto"]),
      encargos: getSourceEncargos(row),
      txEncargos: cleanNumber(row["Tx.Efet"]),
    });
  };

  const getSafeMatch = (candidates) => {
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const distinctSignatures = new Set(candidates.map(getSourceSignature));
    if (distinctSignatures.size === 1) return candidates[0];

    return null;
  };

  const openReplacementIndex = {
    clienteDcto: new Map(),
    sacadoDcto: new Map(),
  };

  sourceItems.forEach((item) => {
    const row = item.row;
    if (hasRowPgto(row) || isStatusBaixado(row)) return;
    if (!isStatusAberto(row) && hasRowPgto(row)) return;

    if (limpaChave(row.Cliente)) {
      addToIndex(openReplacementIndex.clienteDcto, clienteDctoKey(row), item);
    }
    if (limpaChave(row.Sacado)) {
      addToIndex(openReplacementIndex.sacadoDcto, sacadoDctoKey(row), item);
    }
  });

  const findOpenReplacementSource = (targetRow) => {
    if (!isStatusBaixado(targetRow) && !hasRowPgto(targetRow)) return null;

    const candidates = [];
    candidates.push(...(openReplacementIndex.clienteDcto.get(clienteDctoKey(targetRow)) || []));
    candidates.push(...(openReplacementIndex.sacadoDcto.get(sacadoDctoKey(targetRow)) || []));

    return getSafeMatch(Array.from(new Set(candidates)));
  };

  const findMatchedSource = (targetRow) => {
    const openReplacement = findOpenReplacementSource(targetRow);
    if (openReplacement) {
      return {
        matchedSource: openReplacement,
        matchType: "Dcto aberto sem Pgto substitui título baixado",
      };
    }

    const searchSteps = [
      { index: sourceIndex.rawBordero, normalized: false, bordero: true, matchType: "Dcto + Dt.Emis + Vcto + Borderô" },
      { index: sourceIndex.normalizedBordero, normalized: true, bordero: true, matchType: "Dcto normalizado + Dt.Emis + Vcto + Borderô" },
      { index: sourceIndex.raw, normalized: false, bordero: false, matchType: "Dcto + Dt.Emis + Vcto" },
      { index: sourceIndex.normalized, normalized: true, bordero: false, matchType: "Dcto normalizado + Dt.Emis + Vcto" },
    ];

    for (const step of searchSteps) {
      const candidates = [];
      makeMatchKeys(targetRow, step.normalized, step.bordero).forEach((key) => {
        candidates.push(...(step.index.get(key) || []));
      });

      const matchedSource = getSafeMatch(candidates);
      if (matchedSource) return { matchedSource, matchType: step.matchType };
    }

    return null;
  };

  const hasColumn = (targetRow, columnName) =>
    Object.prototype.hasOwnProperty.call(targetRow || {}, columnName);

  const setExistingColumns = (payload, targetRow, columnNames, value) => {
    columnNames.forEach((columnName) => {
      if (hasColumn(targetRow, columnName)) payload[columnName] = value;
    });
  };

  const setExistingColumnsWhenPresent = (payload, targetRow, columnNames, value) => {
    if (value === undefined) return;
    setExistingColumns(payload, targetRow, columnNames, value);
  };

  const buildWbaUpdatePayload = (sourceRow, targetRow, nextInadimplencia) => {
    const payload = { id: targetRow.id };

    const pgto = cleanDate(sourceRow.Pgto) || null;
    const vlPgto = cleanNumber(sourceRow["Vl Pgto"]);
    const encargos = getSourceEncargos(sourceRow);
    const txEncargos = cleanNumber(sourceRow["Tx.Efet"]) ?? 0;

    setExistingColumns(payload, targetRow, ["inadimplencia"], nextInadimplencia ?? null);
    setExistingColumns(
      payload,
      targetRow,
      ["Status"],
      isStatusRecomprado(targetRow.Status) ? targetRow.Status : sourceRow.Status ?? null
    );
    setExistingColumnsWhenPresent(payload, targetRow, ["Cliente"], sourceRow.Cliente);
    setExistingColumnsWhenPresent(payload, targetRow, ["Sacado"], sourceRow.Sacado);
    setExistingColumnsWhenPresent(payload, targetRow, ["Dt.Emis"], cleanDate(sourceRow["Dt.Emis"]) || null);
    setExistingColumnsWhenPresent(payload, targetRow, ["Vcto"], cleanDate(sourceRow.Vcto) || null);
    setExistingColumnsWhenPresent(payload, targetRow, ["Entrada"], cleanNumber(sourceRow.Entrada));
    setExistingColumns(payload, targetRow, ["Dt.Pgto", "Dt Pgto", "Data Pgto", "Data de Pgto", "Data de Pagamento", "Pgto"], pgto);
    setExistingColumns(payload, targetRow, ["Vl.Pgto", "Vl Pgto", "Vl Pgto.", "Valor Pgto", "Valor Pago"], vlPgto);
    setExistingColumns(payload, targetRow, ["Encargos", "Encargo", "Juros e Multa", "Rec."], encargos);
    setExistingColumns(
      payload,
      targetRow,
      ["Tx.Encargos", "Tx Encargos", "Tx.Encargo", "Tx Encargo"],
      txEncargos
    );

    return payload;
  };

  const payloadSignature = (payload) =>
    JSON.stringify(
      Object.keys(payload)
        .filter((key) => key !== "id")
        .sort()
        .reduce((acc, key) => {
          acc[key] = payload[key];
          return acc;
        }, {})
    );

  const matchedRows = [];
  const rowsToUpdate = [];

  secInfoRows.forEach((targetRow) => {
    const match = findMatchedSource(targetRow);
    if (!match) return;

    const { matchedSource, matchType } = match;
    const payload = buildWbaUpdatePayload(matchedSource.row, targetRow, matchedSource.nextValue);

    if (Object.keys(payload).length <= 1) return;

    matchedRows.push({
      id: targetRow.id,
      matchType,
      source: matchedSource.row,
      target: targetRow,
      payload,
    });

    rowsToUpdate.push(payload);
  });

  const fallbackMatchedCount = matchedRows.filter((row) =>
    row.matchType.includes("normalizado") || row.matchType === "Dcto + Dt.Emis + Vcto"
  ).length;

  const uniquePayloadsById = new Map();
  rowsToUpdate.forEach((payload) => {
    uniquePayloadsById.set(payload.id, payload);
  });

  const uniqueRowsToUpdate = Array.from(uniquePayloadsById.values());

  console.group("Atualização WBA secInfo");
  console.log("Linhas WBA classificadas no upload:", sourceItems.length);
  console.log("Borderôs consultados:", borderos);
  console.log("Vctos consultados:", vctos);
  console.log("Linhas candidatas encontradas na secInfo:", secInfoRows?.length || 0);
  console.log("Matches totais:", matchedRows.length);
  console.log("Linhas enviadas para update:", uniqueRowsToUpdate.length);
  if (matchedRows.length === 0) {
    console.table(sourceItems.slice(0, 10).map((item) => item.row));
    console.table((secInfoRows || []).slice(0, 10));
  }
  console.groupEnd();

  let updatedCount = 0;
  const UPDATE_BATCH_SIZE = 500;

  for (let i = 0; i < uniqueRowsToUpdate.length; i += UPDATE_BATCH_SIZE) {
    const batch = uniqueRowsToUpdate.slice(i, i + UPDATE_BATCH_SIZE);
    const { error } = await supabase
      .from("secInfo")
      .upsert(batch, { onConflict: "id" });

    if (error) {
      throw new Error(`Erro ao atualizar dados WBA na secInfo: ${error.message}`);
    }

    updatedCount += batch.length;
    setSmartProgress(`Atualizando dados WBA na secInfo... ${updatedCount} / ${uniqueRowsToUpdate.length}`);
  }

  return {
    updatedCount,
    classifiedCount: sourceItems.length,
    fetchedCount: secInfoRows?.length || 0,
    matchedCount: matchedRows.length,
    fallbackMatchedCount,
    changedCount: uniqueRowsToUpdate.length,
  };
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
  const [smartDeletedRows, setSmartDeletedRows] = useState([]);

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
    const mappedRows = rows
      .slice(headerIndex + 1)
      .map((row) => buildSmartSourceRow(headers, row))
      .map(mapSmartRow);

    return {
      smartRows: mappedRows.filter(isUsefulSmartRow),
      secInfoInadimplenciaRows: mappedRows.filter((row) =>
        hasInadimplenciaValue(row) &&
        limpaChave(row.Dcto) &&
        limpaChave(row.Vcto)
      ),
    };
  };

  const processSmartFiles = async () => {
    if (smartFiles.length === 0) {
      setSmartStatus("❌ Selecione um ou mais arquivos Excel para atualizar a secInfoSmart.");
      return;
    }

    setSmartLoading(true);
    setSmartStatus("");
    setSmartProgress(`Processando ${smartFiles.length} arquivo(s)...`);
    setSmartDeletedRows([]);

    try {
      const rowsByFile = await Promise.all(smartFiles.map(readSmartRows));
      const secInfoInadimplenciaRows = rowsByFile.flatMap((fileRows) => fileRows.secInfoInadimplenciaRows);
      const rowsByKey = new Map();

      rowsByFile.flatMap((fileRows) => fileRows.smartRows).forEach((row) => {
        const key = smartKey(row);
        const existingRow = rowsByKey.get(key);
        const mergedRow = { ...existingRow, ...row };

        if (hasInadimplenciaValue(row)) {
          mergedRow.inadimplencia = row.inadimplencia;
        } else if (hasInadimplenciaValue(existingRow)) {
          mergedRow.inadimplencia = existingRow.inadimplencia;
        } else {
          delete mergedRow.inadimplencia;
        }

        rowsByKey.set(key, mergedRow);
      });

      const smartRows = applySmartEffectiveRates(
        Array.from(rowsByKey.values()).map((row, index) => ({
          ...row,
          "Cód.Red": index + 1,
        }))
      );

      if (smartRows.length === 0 && secInfoInadimplenciaRows.length === 0) {
        throw new Error("Nenhuma linha válida encontrada nos arquivos Smart.");
      }

      let insertedCount = 0;
      let updatedCount = 0;
      let deletedCount = 0;

      if (smartRows.length > 0) {
      setSmartProgress(`Checando registros atuais em ${SMART_TABLE}...`);

      const existingRows = [];
      for (let from = 0; ; from += SMART_BATCH_SIZE) {
        const to = from + SMART_BATCH_SIZE - 1;
        const { data, error: existingError } = await supabase
          .from(SMART_TABLE)
          .select('id,Cliente,Sacado,Dcto,"Borderô",Vcto,Entrada')
          .order("id", { ascending: true })
          .range(from, to);

        if (existingError) {
          throw new Error(`Erro ao checar registros Smart: ${existingError.message}`);
        }

        existingRows.push(...(data || []));
        if (!data || data.length < SMART_BATCH_SIZE) break;
      }

      const existingMap = {};
      existingRows.forEach((row) => {
        existingMap[smartKey(row)] = row;
      });

      const rowsToInsert = [];
      const rowsToUpdate = [];
      const smartKeysInFile = new Set(smartRows.map((row) => smartKey(row)));
      const rowsToDelete = existingRows.filter((row) => row.id && !smartKeysInFile.has(smartKey(row)));
      const deletedRowsSummary = rowsToDelete.map((row) => ({
        id: row.id,
        Cliente: row.Cliente || "",
        Sacado: row.Sacado || "",
        Dcto: row.Dcto || "",
        Bordero: row["Borderô"] || "",
        Vcto: row.Vcto || "",
        Entrada: row.Entrada || 0,
      }));

      smartRows.forEach((row) => {
        const existingRow = existingMap[smartKey(row)];
        if (existingRow?.id) {
          rowsToUpdate.push({ id: existingRow.id, row });
        } else {
          rowsToInsert.push(row);
        }
      });

      for (let i = 0; i < rowsToDelete.length; i += SMART_BATCH_SIZE) {
        const batch = rowsToDelete.slice(i, i + SMART_BATCH_SIZE);
        const ids = batch.map((row) => row.id);
        const { data: deletedRows, error } = await supabase
          .from(SMART_TABLE)
          .delete()
          .in("id", ids)
          .select("id");

        if (error) {
          throw new Error(`Erro ao excluir Smart removido do arquivo: ${error.message}`);
        }

        if ((deletedRows || []).length !== ids.length) {
          throw new Error(`Exclusão Smart não confirmou todos os registros (${(deletedRows || []).length}/${ids.length}). Verifique a permissão de delete no Supabase.`);
        }

        deletedCount += deletedRows.length;
        setSmartProgress(`Excluindo removidos do Smart... ${deletedCount} / ${rowsToDelete.length}`);
      }
      setSmartDeletedRows(deletedRowsSummary);

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

      for (let i = 0; i < rowsToUpdate.length; i += SMART_BATCH_SIZE) {
        const batch = rowsToUpdate
          .slice(i, i + SMART_BATCH_SIZE)
          .map(({ id, row }) => ({
            id,
            ...withoutSmartCodRed(row),
          }));

        const { error } = await supabase
          .from(SMART_TABLE)
          .upsert(batch, { onConflict: "id" });

        if (error) {
          const uniqueMessage = logSmartUniqueViolation(error, batch, "update em lote");
          throw new Error(uniqueMessage || `Erro ao atualizar Smart em lote: ${error.message}`);
        }

        updatedCount += batch.length;
        setSmartProgress(`Atualizando existentes em lote... ${updatedCount} / ${rowsToUpdate.length}`);
      }
      }

      const secInfoInadimplencia = await updateSecInfoInadimplenciaFromSmartRows(secInfoInadimplenciaRows, setSmartProgress);

      setSmartStatus(`✅ Dados Atualizados com Sucesso: ${insertedCount} novo(s), ${updatedCount} atualizado(s), ${deletedCount} removido(s).`);
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
        const excluido = isInadimplente(r);

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
        const htmlRows = parseSmartHtmlWorkbook(data);
        let worksheet = null;
        let rawArray = htmlRows;

        if (!rawArray) {
          const workbook = XLSX.read(data, { type: "array", cellDates: true });
          worksheet = workbook.Sheets[workbook.SheetNames[0]];
          rawArray = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
        }

        let isRates = false;
        for (let r = 0; r < Math.min(rawArray.length, 50); r++) {
          const rowTxt = rawArray[r].map(x => String(x || "").trim().toLowerCase()).join(" ");
          if (rowTxt.includes("border") && (rowTxt.includes("vlr") || rowTxt.includes("face")) && (rowTxt.includes("des") || rowTxt.includes("deságio"))) {
            isRates = true;
            break;
          }
        }

        if (isRates) ratesFiles.push({ name: file.name, rawArray });
        else mainFiles.push({ name: file.name, worksheet, rawArray });
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
        const rawData = sourceRowsFromRawArray(mf.rawArray) ||
          (mf.worksheet ? XLSX.utils.sheet_to_json(mf.worksheet, { defval: null }) : []);

        rawData.forEach((sourceRow) => {
          const row = shouldMapSecInfoSourceRow(sourceRow)
            ? mapSecInfoSourceRow(sourceRow)
            : sourceRow;
          const newRow = {};
          for (let key in row) {
            const cleanKey = String(key).trim();
            if (cleanKey.startsWith("__EMPTY") || cleanKey === "id" || cleanKey === "created_at") continue;
            if (isInadimplenciaColumn(cleanKey)) continue;
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

          const inadimplencia = getInadimplenciaFromSource(sourceRow);
          if (inadimplencia !== undefined) newRow.inadimplencia = inadimplencia;

          if (newRow["Borderô"]) {
            const bNum = parseInt(newRow["Borderô"], 10);
            if (globalRatesMap[bNum]) {
              newRow["Desagio"] = globalRatesMap[bNum].Desagio;
              newRow["Tx.Efet"] = globalRatesMap[bNum]["Tx.Efet"];
            }
          }

const clienteLimpo = String(newRow["Cliente"] || "").trim();

auditoria.extraidasBrutas.push({ ...newRow });

if (!limpaChave(newRow["Dcto"]) || !limpaChave(newRow["Vcto"])) {
  auditoria.semCodRed.push({ ...newRow, motivoExclusao: "Sem chave Dcto + Vcto" });
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
  const originalGroup = groupedByDcto[key];
  const openRows = originalGroup.filter((row) =>
    isStatusAberto(row) || (!hasRowPgto(row) && !isStatusBaixado(row))
  );
  const baixadoRows = originalGroup.filter((row) =>
    isStatusBaixado(row) || hasRowPgto(row)
  );
  const shouldIgnoreBaixados = openRows.length > 0 && baixadoRows.length > 0;
  const group = shouldIgnoreBaixados ? openRows : originalGroup;

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
  cliente: limpaChave(originalGroup[0]["Cliente"]),
  dcto: limpaChave(originalGroup[0]["Dcto"]),
  qtd: originalGroup.length,
  linhas: originalGroup.map((item) => ({ ...item })),
  linhasConsideradas: shouldIgnoreBaixados ? group.map((item) => ({ ...item })) : undefined,
  motivoAjuste: shouldIgnoreBaixados ? "Baixados ignorados por haver título aberto no mesmo Cliente + Dcto" : undefined,
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
const seenSecInfoKeys = new Set();

rowsAfterSum.forEach((r) => {
  const rowKey = secInfoKey(r);
  if (!limpaChave(r["Dcto"]) || !limpaChave(r["Vcto"])) return;

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

  if (seenSecInfoKeys.has(rowKey)) {
    auditoria.excluidasCodRedDuplicado.push({
      ...r,
      motivoExclusao: "Chave Dcto + Borderô + Vcto duplicada no filtro final",
    });
    return;
  }

  seenSecInfoKeys.add(rowKey);
  finalRows.push(r);
});

auditoria.finalRows = finalRows.map((item) => ({ ...item }));
// imprimirAuditoriaUpload(auditoria);

      setProgress(`5/5: Enviando ${finalRows.length} registros para o Supabase (Preservando taxas)...`);

      const BATCH_SIZE = 500;
      const borderos = Array.from(new Set(finalRows.map((row) => row["Borderô"]).filter((value) => value !== null && value !== undefined && value !== "")));
      const vctosSemBordero = Array.from(
        new Set(
          finalRows
            .filter((row) => !limpaChave(row["Borderô"]))
            .map((row) => row.Vcto)
            .filter((value) => value !== null && value !== undefined && value !== "")
        )
      );
      const dctosSemBordero = Array.from(
        new Set(
          finalRows
            .filter((row) => !limpaChave(row["Borderô"]))
            .map((row) => row.Dcto)
            .filter((value) => value !== null && value !== undefined && value !== "")
        )
      );
      const existingDataById = new Map();

      const addExistingRows = (rows) => {
        (rows || []).forEach((row) => {
          if (row?.id) existingDataById.set(row.id, row);
        });
      };

      const fetchExistingByChunks = async (field, values, label) => {
        if (!values.length) return;
        for (let i = 0; i < values.length; i += BATCH_SIZE) {
          const chunk = values.slice(i, i + BATCH_SIZE);
          const { data, error } = await supabase
            .from("secInfo")
            .select('id,Cliente,Sacado,Dcto,"Borderô",Vcto,"Cód.Red",Desagio,"Tx.Efet",Status')
            .in(field, chunk);

          if (error) throw new Error(`Erro ao checar banco por ${label}: ${error.message}`);
          addExistingRows(data);
        }
      };

      await fetchExistingByChunks('"Borderô"', borderos, "Borderô");
      await fetchExistingByChunks("Vcto", vctosSemBordero, "Vcto");
      await fetchExistingByChunks("Dcto", dctosSemBordero, "Dcto");

      const existingData = Array.from(existingDataById.values());

      const existingMap = {};
      const existingBaixadoByClienteDcto = {};
      const existingBaixadoBySacadoDcto = {};
      (existingData || []).forEach((r) => {
        existingMap[secInfoKey(r)] = r;
        if (isStatusBaixado(r)) {
          existingBaixadoByClienteDcto[clienteDctoKey(r)] = r;
          existingBaixadoBySacadoDcto[sacadoDctoKey(r)] = r;
        }
      });

      const rowsToInsert = [];
      const rowsToUpdate = [];

      finalRows.forEach((row) => {
        const existingRow =
          existingMap[secInfoKey(row)] ||
          (isStatusAberto(row)
            ? existingBaixadoByClienteDcto[clienteDctoKey(row)] ||
              existingBaixadoBySacadoDcto[sacadoDctoKey(row)]
            : null);

        if (existingRow?.id) {
          const updateRow = { ...row };
          if (isStatusRecomprado(existingRow.Status)) {
            updateRow.Status = existingRow.Status;
          }
          updateRow["Cód.Red"] = existingRow["Cód.Red"];
          if (updateRow.Desagio === null || updateRow.Desagio === undefined) {
            updateRow.Desagio = existingRow.Desagio;
          }
          if (updateRow["Tx.Efet"] === null || updateRow["Tx.Efet"] === undefined) {
            updateRow["Tx.Efet"] = existingRow["Tx.Efet"];
          }
          rowsToUpdate.push({ id: existingRow.id, row: updateRow });
        } else {
          rowsToInsert.push(row);
        }
      });

      let nextCodRed = 0;
      if (rowsToInsert.some((row) => !limpaChave(row["Cód.Red"]))) {
        const { data: lastCodRedRows, error: lastCodRedError } = await supabase
          .from("secInfo")
          .select('"Cód.Red"')
          .order('"Cód.Red"', { ascending: false })
          .limit(1);

        if (lastCodRedError) throw new Error(`Erro ao buscar próximo Cód.Red: ${lastCodRedError.message}`);
        nextCodRed = cleanNumber(lastCodRedRows?.[0]?.["Cód.Red"]) || 0;
      }

      const rowsToInsertWithCodRed = rowsToInsert.map((row) => {
        if (limpaChave(row["Cód.Red"])) return row;
        nextCodRed += 1;
        return { ...row, "Cód.Red": nextCodRed };
      });

      let insertedCount = 0;
      for (let i = 0; i < rowsToInsertWithCodRed.length; i += BATCH_SIZE) {
        const batch = rowsToInsertWithCodRed.slice(i, i + BATCH_SIZE);
        const { error } = await supabase.from("secInfo").insert(batch);
        if (error) throw new Error(`Erro ao inserir: ${error.message}`);
        insertedCount += batch.length;
        setProgress(`Inserindo novos... ${insertedCount} / ${rowsToInsertWithCodRed.length}`);
      }

      let updatedCount = 0;
      for (let i = 0; i < rowsToUpdate.length; i += 1) {
        const item = rowsToUpdate[i];
        const { error } = await supabase
          .from("secInfo")
          .update(item.row)
          .eq("id", item.id);

        if (error) throw new Error(`Erro ao atualizar: ${error.message}`);
        updatedCount += 1;
        if (updatedCount % 25 === 0 || updatedCount === rowsToUpdate.length) {
          setProgress(`Atualizando existentes... ${updatedCount} / ${rowsToUpdate.length}`);
        }
      }

      setStatus(`✅ Banco de dados atualizado: ${rowsToInsertWithCodRed.length} novo(s), ${rowsToUpdate.length} atualizado(s).`);
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
      {false && (
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
      )}

      <div style={cardStyle}>
        <h2 style={{ marginTop: 0, color: "#111827", fontSize: "20px" }}>Atualização de Dados</h2>
        <p style={{ color: "#6b7280", fontSize: "14px", marginBottom: "20px" }}>
          Caminho para Download do Excel de Títulos: Financeiro -&gt; Títulos -&gt; Clica em Pesquisar -&gt; Gerar Planilha
        </p>


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
              : "Nenhum arquivo selecionado."}
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
          {smartLoading ? "Processando..." : "Processar e Enviar"}
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

        {smartDeletedRows.length > 0 && (
          <div style={{ marginTop: "12px", border: "1px solid #fecaca", borderRadius: "8px", overflow: "hidden", background: "#fff" }}>
            <div style={{ padding: "10px 12px", background: "#fef2f2", color: "#991b1b", fontSize: "13px", fontWeight: 700 }}>
              Registros removidos do secInfoSmart
            </div>
            <div style={{ maxHeight: "260px", overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", whiteSpace: "nowrap" }}>
                <thead>
                  <tr>
                    {["id", "Cliente", "Sacado", "Dcto", "Bordero", "Vcto", "Entrada"].map((col) => (
                      <th key={col} style={{ position: "sticky", top: 0, background: "#fff7ed", color: "#7f1d1d", textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #fecaca", fontWeight: 700 }}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {smartDeletedRows.map((row) => (
                    <tr key={row.id}>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #fee2e2" }}>{row.id}</td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #fee2e2" }}>{row.Cliente}</td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #fee2e2" }}>{row.Sacado}</td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #fee2e2" }}>{row.Dcto}</td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #fee2e2" }}>{row.Bordero}</td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #fee2e2" }}>{row.Vcto}</td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #fee2e2", textAlign: "right" }}>{formatarMoeda(row.Entrada)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
