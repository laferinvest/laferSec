import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

const PAGE_SIZE = 5000;
const SELECT_COLUMNS = 'id,Cliente,Sacado,"Dt.Emis",Vcto,Pgto,"Vl Pgto",Dcto,"Borderô",Entrada,Desagio,"Tx.Efet",Status';

const tableColumns = [
  { key: "Cliente", label: "Cedente" },
  { key: "Sacado", label: "Sacado" },
  { key: "Dt.Emis", label: "Dt.Emis", type: "date" },
  { key: "Vcto", label: "Dt.Vcto", type: "date" },
  { key: "Entrada", label: "Valor de Face", type: "money" },
  { key: "Desagio", label: "Deságio", type: "money" },
  { key: "Dcto", label: "Dcto" },
  { key: "Borderô", label: "Borderô" },
  { key: "Tx.Efet", label: "Tx.Efet", type: "rate" },
];

const normalizeKey = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

const normalizeText = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const getValueByAliases = (row, aliases) => {
  const normalized = Object.entries(row || {}).reduce((acc, [key, value]) => {
    acc[normalizeKey(key)] = value;
    return acc;
  }, {});

  for (const alias of aliases) {
    const value = normalized[normalizeKey(alias)];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }

  return "";
};

const parseNumber = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let text = String(value).trim().replace(/\s/g, "");
  if (text.split(",").length === 2 && text.split(".").length >= 2) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else {
    text = text.replace(",", ".");
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
};

const toLocalIsoDate = (value) => {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatIsoDate(value);
  }

  const raw = String(value).trim().split("T")[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [day, month, year] = raw.split("/");
    return `${year}-${month}-${day}`;
  }
  return "";
};

const formatIsoDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseIsoDate = (iso) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return null;
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date;
};

const addDays = (iso, days) => {
  const date = parseIsoDate(iso);
  if (!date) return "";
  date.setDate(date.getDate() + days);
  return formatIsoDate(date);
};

const getIsoWeekday = (iso) => {
  const date = parseIsoDate(iso);
  return date ? date.getDay() : null;
};

const FIXED_BR_HOLIDAYS = [
  "01-01",
  "04-21",
  "05-01",
  "09-07",
  "10-12",
  "11-02",
  "11-15",
  "11-20",
  "12-25",
];

const EXTRA_HOLIDAYS = [];

const getEasterIso = (year) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return formatIsoDate(new Date(year, month - 1, day));
};

const getMovableBrHolidays = (year) => {
  const easterIso = getEasterIso(year);
  return [
    addDays(easterIso, -48),
    addDays(easterIso, -47),
    addDays(easterIso, -2),
    addDays(easterIso, 60),
  ];
};

const getDefaultBrHolidays = (year) => [
  ...FIXED_BR_HOLIDAYS.map((monthDay) => `${year}-${monthDay}`),
  ...getMovableBrHolidays(year),
  ...EXTRA_HOLIDAYS,
];

const isHoliday = (iso) => {
  const date = parseIsoDate(iso);
  if (!date) return false;
  return getDefaultBrHolidays(date.getFullYear()).includes(iso);
};

const isBusinessDay = (iso) => {
  const weekday = getIsoWeekday(iso);
  return weekday !== 0 && weekday !== 6 && !isHoliday(iso);
};

const shiftVencimentoToBusinessDay = (iso) => {
  let adjustedIso = iso || "";

  while (adjustedIso && !isBusinessDay(adjustedIso)) {
    adjustedIso = addDays(adjustedIso, 1);
  }

  return adjustedIso;
};

const getResumoPeriod = (selectedDateIso) => {
  const isMondayMorningCatchup = getIsoWeekday(selectedDateIso) === 0;
  if (!isMondayMorningCatchup) {
    return {
      selectedDateIso,
      inadimplenciaDateIso: selectedDateIso,
      operacaoDateIso: selectedDateIso,
      paymentStartIso: selectedDateIso,
      paymentEndIso: selectedDateIso,
      isMondayMorningCatchup: false,
    };
  }

  const sextaAnteriorIso = addDays(selectedDateIso, -2);
  return {
    selectedDateIso,
    inadimplenciaDateIso: sextaAnteriorIso,
    operacaoDateIso: sextaAnteriorIso,
    paymentStartIso: sextaAnteriorIso,
    paymentEndIso: selectedDateIso,
    isMondayMorningCatchup: true,
  };
};

const formatDate = (value) => {
  const iso = toLocalIsoDate(value);
  if (!iso) return "";
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
};

const formatMoney = (value, hideValues = false) => {
  if (hideValues) return "R$ -";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(parseNumber(value));
};

const formatRate = (value) => {
  const number = parseNumber(value);
  if (!number) return "";
  return `${number.toFixed(2).replace(".", ",")}%`;
};

const formatEntityName = (value) =>
  String(value || "")
    .trim()
    .replace(/^\d+\s*-\s*/, "")
    .replace(/\s*-\s*sacado\s*$/i, "");

const getTodayIso = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return formatIsoDate(date);
};

const getYesterdayIso = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - 1);
  return formatIsoDate(date);
};

const isQuitadoStatus = (status) => {
  const normalized = normalizeText(status);
  return normalized.includes("quit") || normalized.includes("liquid");
};

const isRecompradoStatus = (status) => normalizeText(status).includes("recompr");

const hasPayment = (row) => Boolean(toLocalIsoDate(row.Pgto));

const isFinalized = (row) =>
  isQuitadoStatus(row.Status) || isRecompradoStatus(row.Status) || hasPayment(row);

const isOpen = (row) => {
  const status = normalizeText(row.Status);
  return (
    status.includes("aberto") ||
    status.includes("vencer") ||
    status.includes("vencido") ||
    status.includes("atras") ||
    (!isFinalized(row) && !status.includes("cancel"))
  );
};

const normalizeRow = (row, sourceTable, index) => ({
  id: row?.id,
  Cliente: getValueByAliases(row, ["Cliente", "Cedente", "CEDENTE"]),
  Sacado: getValueByAliases(row, ["Sacado", "SACADO"]),
  "Dt.Emis": toLocalIsoDate(getValueByAliases(row, ["Dt.Emis", "Data emissao", "Data emissão", "DATA EMISSÃO"])),
  Vcto: toLocalIsoDate(getValueByAliases(row, ["Vcto", "Vencimento", "VENCIMENTO"])),
  Pgto: toLocalIsoDate(getValueByAliases(row, ["Pgto", "Dt.Pgto", "Dt Pgto", "Data Pgto", "Data de Pgto", "Data de Pagamento", "Data de quitação", "DATA DE QUITAÇÃO"])),
  Entrada: parseNumber(getValueByAliases(row, ["Entrada", "Valor", "Valor(R$)", "VALOR(R$)", "Total", "TOTAL(R$)"])),
  Dcto: getValueByAliases(row, ["Dcto", "Documento", "DOCUMENTO"]),
  "Borderô": getValueByAliases(row, ["Borderô", "Bordero", "OP"]),
  Desagio: parseNumber(getValueByAliases(row, ["Desagio", "Deságio", "DESÁGIO"])),
  "Tx.Efet": parseNumber(getValueByAliases(row, ["Tx.Efet", "TX.EFET", "Tx Efet", "Taxa Efetiva"])),
  Status: getValueByAliases(row, ["Status", "Situação", "SITUAÇÃO", "Estado"]),
  _sourceTable: sourceTable,
  _rowKey: `${sourceTable}-${row?.id ?? index}`,
});

async function fetchAllRows(tableName) {
  const allRows = [];
  let useFallbackSelectAll = false;

  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from(tableName)
      .select(useFallbackSelectAll ? "*" : SELECT_COLUMNS)
      .order("id", { ascending: false })
      .range(from, to);

    if (error && !useFallbackSelectAll) {
      useFallbackSelectAll = true;
      const fallback = await supabase
        .from(tableName)
        .select("*")
        .order("id", { ascending: false })
        .range(from, to);

      if (fallback.error) {
        throw new Error(`Erro ao buscar ${tableName}: ${fallback.error.message}`);
      }

      allRows.push(...(fallback.data || []));
      if (!fallback.data || fallback.data.length < PAGE_SIZE) break;
      continue;
    }

    if (error) throw new Error(`Erro ao buscar ${tableName}: ${error.message}`);

    allRows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  return allRows;
}

function SummaryMetric({ label, value, sublabel, color = "#4f46e5" }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "14px 16px", borderTop: `3px solid ${color}` }}>
      <div style={{ fontSize: "11px", fontWeight: 800, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ marginTop: "8px", fontSize: "22px", lineHeight: 1, fontWeight: 800, color: "#111827" }}>
        {value}
      </div>
      {sublabel && (
        <div style={{ marginTop: "8px", fontSize: "12px", color: "#6b7280", fontWeight: 600 }}>
          {sublabel}
        </div>
      )}
    </div>
  );
}

const getMicroFilterForCell = (row, columnKey) => {
  if (columnKey === "Cliente" && row.Cliente) {
    return { type: "cliente", value: row.Cliente };
  }
  if (columnKey === "Sacado" && row.Sacado) {
    return { type: "sacado", value: row.Sacado };
  }
  if (columnKey === "Dcto" && row.Dcto) {
    return { type: "dcto", key: "Dcto", value: row.Dcto, sourceTable: row._sourceTable };
  }
  if (columnKey === "Borderô" && row["Borderô"]) {
    return { type: "bordero", key: "Borderô", value: row["Borderô"], sourceTable: row._sourceTable };
  }
  if (row.Dcto) {
    return { type: "dcto", key: "Dcto", value: row.Dcto, sourceTable: row._sourceTable };
  }
  if (row["Borderô"]) {
    return { type: "bordero", key: "Borderô", value: row["Borderô"], sourceTable: row._sourceTable };
  }
  return null;
};

function MorningTable({ rows, hideValues, onNavigateToMicro }) {
  if (!rows.length) {
    return (
      <div style={{ padding: "22px 18px", color: "#6b7280", fontSize: "14px", textAlign: "center", border: "1px dashed #d1d5db", borderRadius: "8px", background: "#f9fafb" }}>
        Sem títulos para este bloco.
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden", background: "#fff" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "980px", fontSize: "14px", whiteSpace: "nowrap", textAlign: "left" }}>
          <thead>
            <tr style={{ background: "#f9fafb", color: "#374151" }}>
              {tableColumns.map((column) => (
                <th key={column.key} style={{ padding: "12px 16px", borderBottom: "2px solid #e5e7eb", fontWeight: 700 }}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const rowFilter = getMicroFilterForCell(row, "Dcto");

              return (
              <tr
                key={row._rowKey || index}
                onClick={() => rowFilter && onNavigateToMicro?.(rowFilter)}
                title="Abrir no Dados Micro"
                style={{ borderBottom: index === rows.length - 1 ? "0" : "1px solid #e5e7eb", cursor: rowFilter ? "pointer" : "default" }}
              >
                {tableColumns.map((column) => {
                  let value = row[column.key];
                  if (column.type === "date") value = formatDate(value);
                  if (column.type === "money") value = formatMoney(value, hideValues);
                  if (column.type === "rate") value = formatRate(value);
                  if (column.key === "Cliente" || column.key === "Sacado") value = formatEntityName(value);
                  const cellFilter = getMicroFilterForCell(row, column.key);
                  const isDirectFilterCell = ["Cliente", "Sacado", "Dcto", "Borderô"].includes(column.key);

                  return (
                    <td
                      key={column.key}
                      onClick={(event) => {
                        if (!cellFilter) return;
                        event.stopPropagation();
                        onNavigateToMicro?.(cellFilter);
                      }}
                      style={{ padding: "12px 16px", color: "#374151", fontWeight: column.key === "Entrada" ? 700 : 500, cursor: cellFilter ? "pointer" : "default" }}
                    >
                      {isDirectFilterCell && value ? (
                        <span style={{ color: column.key === "Borderô" ? "#4f46e5" : column.key === "Dcto" ? "#0ea5e9" : "#111827", fontWeight: 700, textDecoration: "underline", textDecorationColor: "#d1d5db", textUnderlineOffset: "3px" }}>
                          {value}
                        </span>
                      ) : (
                        value || "-"
                      )}
                    </td>
                  );
                })}
              </tr>
            );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MorningSection({ title, subtitle, rows, hideValues, accent = "#4f46e5", children, onNavigateToMicro, order = 0 }) {
  return (
    <section style={{ order, background: "#fff", border: "1px solid #e5e7eb", borderRadius: "12px", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)", overflow: "hidden" }}>
      <div style={{ padding: "18px 22px", borderTop: `4px solid ${accent}`, borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, color: "#111827", fontSize: "20px", fontWeight: 800, letterSpacing: "-0.01em" }}>
            {title}
          </h2>
          <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "13px", fontWeight: 500 }}>
            {subtitle}
          </p>
        </div>
        <div style={{ color: accent, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "8px 12px", fontSize: "13px", fontWeight: 800 }}>
          {rows.length} título(s)
        </div>
      </div>
      <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: "16px" }}>
        {children}
        <MorningTable rows={rows} hideValues={hideValues} onNavigateToMicro={onNavigateToMicro} />
      </div>
    </section>
  );
}

export default function ResumoMatinal({ hideValues = false, onNavigateToMicro }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const maxSelectableDateIso = useMemo(getYesterdayIso, []);
  const [selectedDateIso, setSelectedDateIso] = useState(maxSelectableDateIso);

  const handleSelectedDateChange = (event) => {
    const nextDate = event.target.value;
    if (!nextDate) return;
    setSelectedDateIso(nextDate >= getTodayIso() ? maxSelectableDateIso : nextDate);
  };

  const resumoPeriod = useMemo(() => getResumoPeriod(selectedDateIso), [selectedDateIso]);

  useEffect(() => {
    let ignore = false;

    async function loadRows() {
      setLoading(true);
      setError("");

      try {
        const [secInfoRows, smartRows] = await Promise.all([
          fetchAllRows("secInfo"),
          fetchAllRows("secInfoSmart"),
        ]);

        if (ignore) return;

        setRows([
          ...(secInfoRows || []).map((row, index) => normalizeRow(row, "secInfo", index)),
          ...(smartRows || []).map((row, index) => normalizeRow(row, "secInfoSmart", index)),
        ]);
      } catch (err) {
        if (!ignore) setError(err.message || "Erro ao carregar o resumo matinal.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadRows();
    return () => {
      ignore = true;
    };
  }, []);

  const resumo = useMemo(() => {
    const validRows = rows.filter((row) => row.Cliente && row.Sacado && row.Entrada > 0);

    const isPaymentInPeriod = (row) =>
      row.Pgto >= resumoPeriod.paymentStartIso && row.Pgto <= resumoPeriod.paymentEndIso;
    const isQuitadoOuPago = (row) =>
      isQuitadoStatus(row.Status) || isRecompradoStatus(row.Status) || hasPayment(row);
    const getVctoOperacional = (row) => shiftVencimentoToBusinessDay(row.Vcto);

    const inadimplenciaOntem = validRows.filter((row) => getVctoOperacional(row) === resumoPeriod.inadimplenciaDateIso && isOpen(row));
    const quitadosOntem = validRows.filter((row) => {
      const vctoOperacional = getVctoOperacional(row);

      if (resumoPeriod.isMondayMorningCatchup) {
        return isPaymentInPeriod(row) && vctoOperacional >= resumoPeriod.inadimplenciaDateIso && isQuitadoOuPago(row);
      }

      return (
        (vctoOperacional === resumoPeriod.inadimplenciaDateIso && (isQuitadoStatus(row.Status) || isRecompradoStatus(row.Status))) ||
        (isPaymentInPeriod(row) && vctoOperacional > resumoPeriod.inadimplenciaDateIso && isQuitadoOuPago(row))
      );
    });
    const quitadosEmAtraso = validRows.filter((row) => (
      isPaymentInPeriod(row) &&
      getVctoOperacional(row) < resumoPeriod.inadimplenciaDateIso &&
      isQuitadoOuPago(row)
    ));
    const operacoesOntem = validRows.filter((row) => row["Dt.Emis"] === resumoPeriod.operacaoDateIso);

    const volumeOperado = operacoesOntem.reduce((acc, row) => acc + row.Entrada, 0);
    const desagioOperado = operacoesOntem.reduce((acc, row) => acc + row.Desagio, 0);
    const taxaMediaPonderada = volumeOperado > 0
      ? operacoesOntem.reduce((acc, row) => acc + row["Tx.Efet"] * row.Entrada, 0) / volumeOperado
      : 0;

    const sortByCedente = (a, b) =>
      String(a.Cliente || "").localeCompare(String(b.Cliente || ""), "pt-BR") ||
      String(a.Sacado || "").localeCompare(String(b.Sacado || ""), "pt-BR");

    return {
      inadimplenciaOntem: [...inadimplenciaOntem].sort(sortByCedente),
      quitadosOntem: [...quitadosOntem].sort(sortByCedente),
      quitadosEmAtraso: [...quitadosEmAtraso].sort(sortByCedente),
      operacoesOntem: [...operacoesOntem].sort(sortByCedente),
      volumeOperado,
      desagioOperado,
      taxaMediaPonderada,
    };
  }, [rows, resumoPeriod]);

  if (loading) {
    return (
      <div style={{ background: "#fff", padding: "40px", borderRadius: "12px", border: "1px solid #e5e7eb", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)", textAlign: "center", color: "#6b7280", fontSize: "15px", fontWeight: 600 }}>
        Carregando resumo matinal...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ background: "#fef2f2", padding: "18px 20px", borderRadius: "12px", border: "1px solid #fecaca", color: "#991b1b", fontSize: "14px", fontWeight: 700 }}>
        {error}
      </div>
    );
  }

  const selectedDateLabel = formatDate(selectedDateIso);
  const paymentWindowLabel = resumoPeriod.isMondayMorningCatchup
    ? `${formatDate(resumoPeriod.paymentStartIso)} a ${formatDate(resumoPeriod.paymentEndIso)}`
    : selectedDateLabel;
  const inadimplenciaSubtitle = resumoPeriod.isMondayMorningCatchup
    ? `Títulos com vencimento em ${formatDate(resumoPeriod.inadimplenciaDateIso)} que ainda estão em aberto.`
    : "Títulos com vencimento na data selecionada que ainda estão em aberto.";
  const quitadosSubtitle = resumoPeriod.isMondayMorningCatchup
    ? `Títulos quitados entre ${paymentWindowLabel}, sem vencimento anterior a ${formatDate(resumoPeriod.inadimplenciaDateIso)}.`
    : "Títulos com vencimento na data selecionada ou antecipados nessa data.";
  const quitadosAtrasoSubtitle = resumoPeriod.isMondayMorningCatchup
    ? `Títulos quitados entre ${paymentWindowLabel} com vencimento anterior a ${formatDate(resumoPeriod.inadimplenciaDateIso)}.`
    : "Títulos quitados na data selecionada com vencimento anterior.";
  const operacoesSubtitle = resumoPeriod.isMondayMorningCatchup
    ? `Novos títulos emitidos em ${formatDate(resumoPeriod.operacaoDateIso)}.`
    : "Novos títulos emitidos na data selecionada.";

  return (
    <main style={{ display: "flex", flexDirection: "column", gap: "24px", paddingBottom: "24px" }}>
      <div style={{ background: "#fff", padding: "22px 24px", borderRadius: "12px", border: "1px solid #e5e7eb", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)", display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, color: "#111827", fontSize: "26px", fontWeight: 800, letterSpacing: "-0.02em" }}>
            Resumo Matinal
          </h1>
          <p style={{ margin: "8px 0 0", color: "#6b7280", fontSize: "14px", fontWeight: 500 }}>
            Visão operacional de {paymentWindowLabel}.
          </p>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "190px" }}>
          <span style={{ fontSize: "12px", fontWeight: 800, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Data
          </span>
          <input
            type="date"
            value={selectedDateIso}
            max={maxSelectableDateIso}
            onChange={handleSelectedDateChange}
            style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #d1d5db", background: "#fff", color: "#111827", fontSize: "14px", fontWeight: 700, outline: "none", boxSizing: "border-box" }}
          />
        </label>
      </div>

      <MorningSection
        title="Inadimplência do Dia"
        subtitle={inadimplenciaSubtitle}
        rows={resumo.inadimplenciaOntem}
        hideValues={hideValues}
        accent="#ef4444"
        order={2}
        onNavigateToMicro={onNavigateToMicro}
      />

      <MorningSection
        title="Quitados do Dia"
        subtitle={quitadosSubtitle}
        rows={resumo.quitadosOntem}
        hideValues={hideValues}
        accent="#22c55e"
        order={3}
        onNavigateToMicro={onNavigateToMicro}
      />

      <MorningSection
        title="Quitado em Atraso"
        subtitle={quitadosAtrasoSubtitle}
        rows={resumo.quitadosEmAtraso}
        hideValues={hideValues}
        accent="#f59e0b"
        order={4}
        onNavigateToMicro={onNavigateToMicro}
      />

      <MorningSection
        title="Operações do Dia"
        subtitle={operacoesSubtitle}
        rows={resumo.operacoesOntem}
        hideValues={hideValues}
        accent="#4f46e5"
        order={1}
        onNavigateToMicro={onNavigateToMicro}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
          <SummaryMetric
            label="Volume Total Operado"
            value={formatMoney(resumo.volumeOperado, hideValues)}
            sublabel={`${resumo.operacoesOntem.length} título(s) emitido(s)`}
            color="#4f46e5"
          />
          <SummaryMetric
            label="Deságio Ganho"
            value={formatMoney(resumo.desagioOperado, hideValues)}
            sublabel="Soma do deságio das entradas"
            color="#f59e0b"
          />
          <SummaryMetric
            label="Taxa Média Ponderada"
            value={formatRate(resumo.taxaMediaPonderada) || "0,00%"}
            sublabel="Ponderada pelo valor de face"
            color="#0ea5e9"
          />
        </div>
      </MorningSection>
    </main>
  );
}
