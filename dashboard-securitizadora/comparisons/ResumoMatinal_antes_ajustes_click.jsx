import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

const PAGE_SIZE = 5000;
const SELECT_COLUMNS = 'id,Cliente,Sacado,"Dt.Emis",Vcto,Pgto,"Vl Pgto",Dcto,"Borderô",Entrada,"Tx.Efet",Status';

const tableColumns = [
  { key: "Cliente", label: "Cedente" },
  { key: "Sacado", label: "Sacado" },
  { key: "Dt.Emis", label: "Dt.Emis", type: "date" },
  { key: "Vcto", label: "Dt.Vcto", type: "date" },
  { key: "Entrada", label: "Valor de Face", type: "money" },
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

function MorningTable({ rows, hideValues }) {
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
            {rows.map((row, index) => (
              <tr key={row._rowKey || index} style={{ borderBottom: index === rows.length - 1 ? "0" : "1px solid #e5e7eb" }}>
                {tableColumns.map((column) => {
                  let value = row[column.key];
                  if (column.type === "date") value = formatDate(value);
                  if (column.type === "money") value = formatMoney(value, hideValues);
                  if (column.type === "rate") value = formatRate(value);

                  return (
                    <td key={column.key} style={{ padding: "12px 16px", color: "#374151", fontWeight: column.key === "Entrada" ? 700 : 500 }}>
                      {value || "-"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MorningSection({ title, subtitle, rows, hideValues, accent = "#4f46e5", children }) {
  return (
    <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "12px", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)", overflow: "hidden" }}>
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
        <MorningTable rows={rows} hideValues={hideValues} />
      </div>
    </section>
  );
}

export default function ResumoMatinal({ hideValues = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const ontemIso = useMemo(getYesterdayIso, []);

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

    const inadimplenciaOntem = validRows.filter((row) => row.Vcto === ontemIso && isOpen(row));
    const quitadosOntem = validRows.filter((row) => row.Vcto === ontemIso && (isQuitadoStatus(row.Status) || isRecompradoStatus(row.Status)));
    const quitadosEmAtraso = validRows.filter((row) => (
      row.Pgto === ontemIso &&
      row.Vcto !== ontemIso &&
      (isQuitadoStatus(row.Status) || hasPayment(row)) &&
      !isRecompradoStatus(row.Status)
    ));
    const operacoesOntem = validRows.filter((row) => row["Dt.Emis"] === ontemIso);

    const volumeOperado = operacoesOntem.reduce((acc, row) => acc + row.Entrada, 0);
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
      taxaMediaPonderada,
    };
  }, [rows, ontemIso]);

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

  return (
    <main style={{ display: "flex", flexDirection: "column", gap: "24px", paddingBottom: "24px" }}>
      <div style={{ background: "#fff", padding: "22px 24px", borderRadius: "12px", border: "1px solid #e5e7eb", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)" }}>
        <h1 style={{ margin: 0, color: "#111827", fontSize: "26px", fontWeight: 800, letterSpacing: "-0.02em" }}>
          Resumo Matinal
        </h1>
        <p style={{ margin: "8px 0 0", color: "#6b7280", fontSize: "14px", fontWeight: 500 }}>
          Visão operacional de ontem, {formatDate(ontemIso)}.
        </p>
      </div>

      <MorningSection
        title="Inadimplência de Ontem"
        subtitle="Títulos com vencimento ontem que ainda estão em aberto."
        rows={resumo.inadimplenciaOntem}
        hideValues={hideValues}
        accent="#ef4444"
      />

      <MorningSection
        title="Quitados de Ontem"
        subtitle="Títulos com vencimento ontem que já aparecem como quitados, liquidados ou recomprados."
        rows={resumo.quitadosOntem}
        hideValues={hideValues}
        accent="#22c55e"
      />

      <MorningSection
        title="Quitado em Atraso"
        subtitle="Títulos quitados ontem com vencimento diferente de ontem."
        rows={resumo.quitadosEmAtraso}
        hideValues={hideValues}
        accent="#f59e0b"
      />

      <MorningSection
        title="Operações de Ontem"
        subtitle="Novos títulos emitidos ontem."
        rows={resumo.operacoesOntem}
        hideValues={hideValues}
        accent="#4f46e5"
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
          <SummaryMetric
            label="Volume Total Operado"
            value={formatMoney(resumo.volumeOperado, hideValues)}
            sublabel={`${resumo.operacoesOntem.length} título(s) emitido(s)`}
            color="#4f46e5"
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
