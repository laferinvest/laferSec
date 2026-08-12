import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import {
  applyPortfolioStatuses,
  calcularDiasAtrasoTitulo,
  isValidPortfolioRow,
} from "./portfolioRiskRules";
import {
  deriveHhiTarget,
  evaluateRiskLimit,
  getRiskMetricSnapshots,
  limitToInputValue,
  loadRiskWorkflow,
  RISK_LIMIT_DEFINITIONS,
  saveRiskLimits,
  syncRiskWorkflow,
  updateRiskAction,
} from "./riskWorkflow";
import "./RiskDashboard.css";

const SOURCE_TABLES = ["secInfo", "secInfoSmart"];
const PAGE_SIZE = 1000;
const SELECT_COLUMNS =
  'id,Cliente,Sacado,"Dt.Emis",Vcto,Pgto,"Vl Pgto",Dcto,"Borderô",Entrada,Desagio,"Tx.Efet",Status,inadimplencia';

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

const compactMoneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getValueByAliases(row, aliases) {
  if (!row) return undefined;
  const normalized = Object.entries(row).reduce((map, [key, value]) => {
    map[normalizeText(key)] = value;
    return map;
  }, {});

  for (const alias of aliases) {
    const value = normalized[normalizeText(alias)];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}

function parseNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined || value === "") return 0;
  const raw = String(value).trim().replace(/R\$|%|\s/g, "");
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  const raw = String(value).trim().split("T")[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [day, month, year] = raw.split("/").map(Number);
    return new Date(year, month - 1, day);
  }
  return null;
}

function dayStart(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysBetween(laterDate, earlierDate) {
  if (!laterDate || !earlierDate) return 0;
  return Math.floor((dayStart(laterDate) - dayStart(earlierDate)) / 86400000);
}

function entityKey(value) {
  return normalizeText(
    String(value ?? "")
      .replace(/^\d+\s*-\s*/, "")
      .replace(/\s*-\s*sacado\s*$/i, ""),
  );
}

function displayEntity(value, fallback = "Não identificado") {
  const cleaned = String(value ?? "")
    .replace(/^\d+\s*-\s*/, "")
    .replace(/\s*-\s*sacado\s*$/i, "")
    .trim();
  return cleaned || fallback;
}

function normalizeRow(row, sourceTable, index) {
  const cliente = getValueByAliases(row, ["Cliente", "Cedente"]);
  const sacado = getValueByAliases(row, ["Sacado"]);
  const status = getValueByAliases(row, ["Status", "Situação", "Estado"]);
  const pgto = getValueByAliases(row, ["Pgto", "Data de quitação", "Data de Pagamento"]);
  const paymentValue = parseNumber(getValueByAliases(row, ["Vl Pgto", "Liquidado", "Valor Pago"]));

  return {
    ...row,
    Cliente: cliente ?? "",
    Sacado: sacado ?? "",
    "Dt.Emis": getValueByAliases(row, ["Dt.Emis", "Data emissão", "Data de emissão"]),
    Vcto: getValueByAliases(row, ["Vcto", "Vencimento"]),
    Pgto: pgto,
    "Vl Pgto": paymentValue,
    Entrada: parseNumber(getValueByAliases(row, ["Entrada", "Valor", "Valor(R$)", "Total"])),
    Status: status ?? "",
    inadimplencia: getValueByAliases(row, ["inadimplencia"]),
    _sourceTable: sourceTable,
    _rowKey: `${sourceTable}-${row?.id ?? index}`,
  };
}

function isRecompra(row) {
  return row._status === "recompra";
}

async function fetchAllRows(tableName) {
  const rows = [];
  let selectAll = false;

  for (let from = 0; ; from += PAGE_SIZE) {
    let response = await supabase
      .from(tableName)
      .select(selectAll ? "*" : SELECT_COLUMNS)
      .order("id", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (response.error && !selectAll) {
      selectAll = true;
      response = await supabase
        .from(tableName)
        .select("*")
        .order("id", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
    }

    if (response.error) throw response.error;
    rows.push(...(response.data || []));
    if (!response.data || response.data.length < PAGE_SIZE) break;
  }

  return rows;
}

function normalizeGroup(group) {
  return {
    id: group.id,
    label: String(group.nome || "").trim(),
    prefixes: Array.isArray(group.prefixos)
      ? group.prefixos.map(entityKey).filter(Boolean)
      : [],
  };
}

function findEconomicGroup(cliente, groups) {
  const key = entityKey(cliente);
  if (!key) return null;
  let match = null;
  let matchLength = -1;

  groups.forEach((group) => {
    group.prefixes.forEach((prefix) => {
      if ((key === prefix || key.startsWith(`${prefix} `)) && prefix.length > matchLength) {
        match = group;
        matchLength = prefix.length;
      }
    });
  });
  return match;
}

function aggregateExposure(rows, identityGetter) {
  const map = new Map();
  rows.forEach((row) => {
    const identity = identityGetter(row);
    if (!identity?.key) return;
    const current = map.get(identity.key) || { ...identity, value: 0, count: 0 };
    current.value += row.Entrada;
    current.count += 1;
    map.set(identity.key, current);
  });

  return [...map.values()].sort((a, b) => b.value - a.value);
}

function concentrationStats(items, totalPortfolio, patrimonio) {
  const shares = items.map((item) => (totalPortfolio > 0 ? item.value / totalPortfolio : 0));
  const hhi = shares.reduce((sum, share) => sum + share * share, 0);
  const topValue = (count) => items.slice(0, count).reduce((sum, item) => sum + item.value, 0);

  return {
    items,
    hhi,
    effectiveNames: hhi > 0 ? 1 / hhi : 0,
    top1Portfolio: totalPortfolio > 0 ? topValue(1) / totalPortfolio : 0,
    top5Portfolio: totalPortfolio > 0 ? topValue(5) / totalPortfolio : 0,
    top10Portfolio: totalPortfolio > 0 ? topValue(10) / totalPortfolio : 0,
    top1Pl: patrimonio > 0 ? topValue(1) / patrimonio : null,
    top5Pl: patrimonio > 0 ? topValue(5) / patrimonio : null,
    top10Pl: patrimonio > 0 ? topValue(10) / patrimonio : null,
  };
}

function monthKey(date) {
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key) {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" })
    .format(new Date(year, month - 1, 1))
    .replace(" de ", "/");
}

function buildMonthlyTrend(rows, groups) {
  const now = new Date();
  const keys = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    return monthKey(date);
  });
  const buckets = new Map(keys.map((key) => [key, { key, volume: 0, titles: 0, weightedTerm: 0, cedentes: new Map() }]));

  rows.forEach((row) => {
    const issueDate = parseDate(row["Dt.Emis"]);
    const key = monthKey(issueDate);
    const bucket = buckets.get(key);
    if (!bucket) return;
    const dueDate = parseDate(row.Vcto);
    const term = dueDate && issueDate ? Math.max(0, daysBetween(dueDate, issueDate)) : 0;
    const economicGroup = findEconomicGroup(row.Cliente, groups);
    const cedenteKey = economicGroup
      ? `group:${economicGroup.id || entityKey(economicGroup.label)}`
      : `standalone:${entityKey(row.Cliente)}`;

    bucket.volume += row.Entrada;
    bucket.titles += 1;
    bucket.weightedTerm += term * row.Entrada;
    bucket.cedentes.set(cedenteKey, (bucket.cedentes.get(cedenteKey) || 0) + row.Entrada);
  });

  return [...buckets.values()].map((bucket) => {
    const hhi = bucket.volume > 0
      ? [...bucket.cedentes.values()].reduce((sum, value) => sum + (value / bucket.volume) ** 2, 0)
      : 0;
    return {
      key: bucket.key,
      label: monthLabel(bucket.key),
      volume: bucket.volume,
      ticket: bucket.titles > 0 ? bucket.volume / bucket.titles : 0,
      term: bucket.volume > 0 ? bucket.weightedTerm / bucket.volume : 0,
      hhi,
    };
  });
}

function buildDelinquency(openRows) {
  const definitions = [
    { key: "current", label: "Em dia", min: Number.NEGATIVE_INFINITY, max: 0, color: "#16a34a" },
    { key: "1-15", label: "1–15 dias", min: 1, max: 15, color: "#f59e0b" },
    { key: "16-30", label: "16–30 dias", min: 16, max: 30, color: "#f97316" },
    { key: "31-60", label: "31–60 dias", min: 31, max: 60, color: "#ef4444" },
    { key: "61-90", label: "61–90 dias", min: 61, max: 90, color: "#dc2626" },
    { key: "90+", label: "Acima de 90", min: 91, max: Number.POSITIVE_INFINITY, color: "#991b1b" },
    { key: "no-date", label: "Sem vencimento", min: null, max: null, color: "#64748b" },
  ];
  const buckets = definitions.map((definition) => ({ ...definition, value: 0, count: 0 }));
  openRows.forEach((row) => {
    const hasDueDate = Boolean(row.Vcto);
    const daysPastDue = row._status === "atraso"
      ? calcularDiasAtrasoTitulo(row, "Vcto", "Pgto")
      : 0;
    const bucket = !hasDueDate
      ? buckets.find((item) => item.key === "no-date")
      : buckets.find((item) => daysPastDue >= item.min && daysPastDue <= item.max);
    if (!bucket) return;
    bucket.value += row.Entrada;
    bucket.count += 1;
  });
  return buckets;
}

function buildCedenteHistory(rows, openRows, groups) {
  const history = new Map();
  const openExposure = new Map();

  openRows.forEach((row) => {
    const key = entityKey(row.Cliente);
    openExposure.set(key, (openExposure.get(key) || 0) + row.Entrada);
  });

  rows.forEach((row) => {
    const key = entityKey(row.Cliente);
    if (!key) return;
    const current = history.get(key) || {
      key,
      name: displayEntity(row.Cliente),
      titles: 0,
      settled: 0,
      onTime: 0,
      lateSettled: 0,
      lateDaysTotal: 0,
      repurchases: 0,
      flagged: 0,
    };
    current.titles += 1;
    if (isRecompra(row)) current.repurchases += 1;
    if (normalizeText(row.inadimplencia) === "sim") current.flagged += 1;
    if (["liquidado", "liquidadoAtraso"].includes(row._status)) {
      current.settled += 1;
      if (row._status === "liquidadoAtraso") {
        current.lateSettled += 1;
        current.lateDaysTotal += calcularDiasAtrasoTitulo(row, "Vcto", "Pgto");
      } else {
        current.onTime += 1;
      }
    }
    history.set(key, current);
  });

  return [...history.values()]
    .map((item) => {
      const group = findEconomicGroup(item.name, groups);
      return {
        ...item,
        group: group?.label || "Sem grupo cadastrado",
        openExposure: openExposure.get(item.key) || 0,
        onTimeRate: item.settled > 0 ? item.onTime / item.settled : null,
        averageLateDays: item.lateSettled > 0 ? item.lateDaysTotal / item.lateSettled : 0,
      };
    })
    .sort((a, b) => b.openExposure - a.openExposure || b.titles - a.titles);
}

function formatMoney(value, hidden, compact = false) {
  if (hidden) return "R$ ••••••";
  return (compact ? compactMoneyFormatter : moneyFormatter).format(Number(value) || 0);
}

function formatPercent(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "TBA";
  return `${(value * 100).toFixed(digits).replace(".", ",")}%`;
}

function formatHhi(value) {
  return Number.isFinite(value)
    ? `${(value * 100).toFixed(2).replace(".", ",")}%`
    : "TBA";
}

function Tba({ detail }) {
  return (
    <span className="risk-tba" title={detail || "Dado ainda não disponível"}>
      TBA
    </span>
  );
}

function RiskCardAlert({ alerts = [], configured = false, hidden = false }) {
  const activeAlerts = alerts.filter((alert) => alert.status !== "resolved");
  const criticalCount = activeAlerts.filter((alert) => alert.level === "critical").length;
  const attentionCount = activeAlerts.filter((alert) => alert.level === "attention").length;
  const tone = criticalCount > 0 ? "red" : attentionCount > 0 ? "amber" : configured ? "green" : "neutral";
  const headline = criticalCount > 0
    ? `${criticalCount} crítico${criticalCount > 1 ? "s" : ""}${attentionCount > 0 ? ` · ${attentionCount} atenção` : ""}`
    : attentionCount > 0
      ? `${attentionCount} atenção`
      : configured ? "Dentro dos limites" : "Limites não configurados";
  const visibleAlerts = activeAlerts.slice(0, 2);
  const detail = visibleAlerts.length > 0
    ? visibleAlerts.map((alert) => {
      const definition = RISK_LIMIT_DEFINITIONS.find((item) => item.key === alert.metric_key);
      return `${alert.title}: ${formatWorkflowValue(alert.current_value, definition?.unit, hidden)}`;
    }).join(" · ") + (activeAlerts.length > visibleAlerts.length ? ` · +${activeAlerts.length - visibleAlerts.length}` : "")
    : configured ? "Nenhum alerta ativo neste grupo" : "Defina os limites para iniciar o monitoramento";

  return (
    <div className={`risk-card-alert risk-card-alert-${tone}`}>
      <span className="risk-card-alert-dot" />
      <div><strong>{headline}</strong><small>{detail}</small></div>
    </div>
  );
}

function MetricCard({ eyebrow, value, detail, tone = "indigo", riskAlert }) {
  return (
    <article className={`risk-metric risk-tone-${tone}`}>
      <span className="risk-metric-accent" />
      {riskAlert && <RiskCardAlert {...riskAlert} />}
      <div className="risk-metric-eyebrow">{eyebrow}</div>
      <div className="risk-metric-value">{value}</div>
      <div className="risk-metric-detail">{detail}</div>
    </article>
  );
}

function SectionHeader({ kicker, title, description, aside }) {
  return (
    <div className="risk-section-header">
      <div>
        {kicker && <div className="risk-kicker">{kicker}</div>}
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {aside && <div className="risk-section-aside">{aside}</div>}
    </div>
  );
}

function ConcentrationCard({ title, effectiveLabel, stats, hidden, hhiLimit, patrimonio, riskAlert }) {
  const leader = stats.items[0];
  const hhiTarget = hhiLimit?.enabled && hhiLimit.unit === "currency"
    ? deriveHhiTarget(hhiLimit.warning_value, patrimonio)
    : null;
  return (
    <article className="risk-panel risk-concentration-card">
      <RiskCardAlert {...riskAlert} hidden={hidden} />
      <div className="risk-card-title-row">
        <div>
          <div className="risk-kicker">Concentração</div>
          <h3>{title}</h3>
        </div>
        <div className="risk-hhi-badge">
          <span>HHI</span>
          <strong>{formatHhi(stats.hhi)}</strong>
        </div>
      </div>
      <div className="risk-effective-names">
        <span>{effectiveLabel}</span>
        <strong>{stats.effectiveNames ? stats.effectiveNames.toFixed(1).replace(".", ",") : "0"}</strong>
      </div>
      <div className="risk-top-grid">
        <div><span>Top 1 / carteira</span><strong>{formatPercent(stats.top1Portfolio)}</strong></div>
        <div><span>Top 5 / carteira</span><strong>{formatPercent(stats.top5Portfolio)}</strong></div>
        <div><span>Top 10 / carteira</span><strong>{formatPercent(stats.top10Portfolio)}</strong></div>
        <div><span>Top 1 / PL</span><strong>{formatPercent(stats.top1Pl)}</strong></div>
        <div><span>Top 5 / PL</span><strong>{formatPercent(stats.top5Pl)}</strong></div>
        <div><span>Top 10 / PL</span><strong>{formatPercent(stats.top10Pl)}</strong></div>
      </div>
      <div className="risk-leader">
        <span>Maior exposição</span>
        <strong title={leader?.label}>{leader?.label || "Sem dados"}</strong>
        <b>{leader ? formatMoney(leader.value, hidden, true) : formatMoney(0, hidden, true)}</b>
      </div>
      <div className="risk-limit-footnote">
        {hhiTarget
          ? <>Ticket médio alvo: <strong>{formatMoney(hhiTarget.ticket, hidden, true)}</strong> · HHI máximo: <strong>{formatHhi(hhiTarget.hhi)}</strong> · N objetivo: <strong>{hhiTarget.effectiveNames.toFixed(1).replace(".", ",")}</strong></>
          : <>Meta de HHI: <Tba detail="Configure o ticket médio alvo na política de risco" /></>}
      </div>
    </article>
  );
}

function TrendMetric({ label, value, formatter, previousValue }) {
  const delta = previousValue > 0 ? (value - previousValue) / previousValue : null;
  const deltaLabel = delta === null
    ? "Sem base anterior"
    : `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1).replace(".", ",")}% vs. mês anterior`;
  return (
    <div className="risk-trend-metric">
      <span>{label}</span>
      <strong>{formatter(value)}</strong>
      <small className={delta !== null && delta > 0 ? "risk-delta-up" : ""}>{deltaLabel}</small>
    </div>
  );
}

function OverviewView({ data, hidden, limits, alerts = [] }) {
  const limitsByKey = new Map(limits.map((limit) => [limit.metric_key, limit]));
  const activeAlerts = alerts.filter((alert) => alert.status !== "resolved");
  const cardRisk = (metricKeys) => ({
    alerts: activeAlerts.filter((alert) => metricKeys.includes(alert.metric_key)),
    configured: metricKeys.some((key) => limitsByKey.get(key)?.enabled),
    hidden,
  });
  const cedenteRisk = cardRisk(["cedente_top1_pl", "cedente_top5_pl", "hhi_cedente"]);
  const sacadoRisk = cardRisk(["sacado_top1_pl", "sacado_top5_pl", "hhi_sacado"]);
  const overdueRisk = cardRisk(["overdue_30_portfolio", "overdue_90_portfolio"]);
  const currentTrend = data.trend[data.trend.length - 1] || {};
  const previousTrend = data.trend[data.trend.length - 2] || {};
  const maxMonthlyVolume = Math.max(...data.trend.map((item) => item.volume), 1);
  const overdueBuckets = data.delinquency.filter((item) => !["current", "no-date"].includes(item.key));
  const overdueTotal = overdueBuckets.reduce((sum, item) => sum + item.value, 0);
  const overdueCount = overdueBuckets.reduce((sum, item) => sum + item.count, 0);
  const severeOverdue = data.delinquency
    .filter((item) => ["31-60", "61-90", "90+"].includes(item.key))
    .reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="risk-view-stack">
      <section className="risk-executive-grid">
        <MetricCard
          eyebrow="Exposição em aberto"
          value={formatMoney(data.totalOpen, hidden)}
          detail={`${data.openRows.length.toLocaleString("pt-BR")} título(s) na carteira atual`}
          tone="indigo"
        />
        <MetricCard
          eyebrow="Exposição vencida"
          value={formatMoney(overdueTotal, hidden)}
          detail={`${overdueCount.toLocaleString("pt-BR")} título(s) com atraso`}
          tone={overdueTotal > 0 ? "amber" : "green"}
        />
        <MetricCard
          eyebrow="Atraso acima de 30 dias"
          value={formatMoney(severeOverdue, hidden)}
          detail={`${formatPercent(data.totalOpen > 0 ? severeOverdue / data.totalOpen : 0)} da carteira em aberto`}
          tone={severeOverdue > 0 ? "red" : "green"}
          riskAlert={overdueRisk}
        />
        <MetricCard
          eyebrow="Patrimônio de referência"
          value={data.patrimonio > 0 ? formatMoney(data.patrimonio, hidden) : <Tba detail="Snapshot de patrimônio ainda não disponível" />}
          detail="Recebíveis + dinheiro em banco no último snapshot"
          tone="slate"
        />
      </section>

      <section>
        <SectionHeader
          kicker="Mapa da carteira"
          title="Concentração e pulverização"
          description="Cedentes do mesmo grupo econômico são consolidados como uma única exposição. O HHI usa a participação sobre a carteira em aberto."
        />
        <div className="risk-concentration-grid">
          <ConcentrationCard title="Cedentes" effectiveLabel="Cedentes efetivos" stats={data.cedenteStats} hidden={hidden} hhiLimit={limitsByKey.get("hhi_cedente")} patrimonio={data.patrimonio} riskAlert={cedenteRisk} />
          <ConcentrationCard title="Sacados" effectiveLabel="Sacados efetivos" stats={data.sacadoStats} hidden={hidden} hhiLimit={limitsByKey.get("hhi_sacado")} patrimonio={data.patrimonio} riskAlert={sacadoRisk} />
        </div>
      </section>

      <section className="risk-two-column">
        <article className="risk-panel">
          <SectionHeader
            kicker="Comportamento"
            title="Faixas de atraso"
            description="Posição dos títulos ainda em aberto pela quantidade de dias após o vencimento."
          />
          <div className="risk-delinquency-list">
            {data.delinquency.map((bucket) => {
              const share = data.totalOpen > 0 ? bucket.value / data.totalOpen : 0;
              return (
                <div className="risk-delinquency-row" key={bucket.key}>
                  <div className="risk-delinquency-label"><span style={{ background: bucket.color }} />{bucket.label}</div>
                  <div className="risk-delinquency-bar"><i style={{ width: `${Math.max(share * 100, bucket.value > 0 ? 2 : 0)}%`, background: bucket.color }} /></div>
                  <div className="risk-delinquency-value">
                    <strong>{formatMoney(bucket.value, hidden, true)}</strong>
                    <span>{bucket.count} título(s) · {formatPercent(share)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <article className="risk-panel">
          <SectionHeader
            kicker="Originação"
            title="Tendências dos últimos 6 meses"
            description="Volume, ticket, prazo e HHI das novas operações pela data de emissão."
          />
          <div className="risk-trend-summary">
            <TrendMetric label="Volume" value={currentTrend.volume || 0} previousValue={previousTrend.volume || 0} formatter={(value) => formatMoney(value, hidden, true)} />
            <TrendMetric label="Ticket" value={currentTrend.ticket || 0} previousValue={previousTrend.ticket || 0} formatter={(value) => formatMoney(value, hidden, true)} />
            <TrendMetric label="Prazo médio" value={currentTrend.term || 0} previousValue={previousTrend.term || 0} formatter={(value) => `${value.toFixed(0)} dias`} />
            <TrendMetric label="HHI cedente" value={currentTrend.hhi || 0} previousValue={previousTrend.hhi || 0} formatter={formatHhi} />
          </div>
          <div className="risk-volume-chart" aria-label="Volume mensal das operações">
            {data.trend.map((item) => (
              <div className="risk-volume-column" key={item.key} title={`${item.label}: ${formatMoney(item.volume, hidden)}`}>
                <div className="risk-volume-track"><i style={{ height: `${Math.max((item.volume / maxMonthlyVolume) * 100, item.volume > 0 ? 4 : 0)}%` }} /></div>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section>
        <SectionHeader
          kicker="Cenários conservadores"
          title="Stress de maiores sacados"
          description="Simulação bruta com LGD de 100%. A perda líquida será recalculada quando recuperações e garantias estiverem disponíveis."
          aside={<span className="risk-info-chip">LGD real <Tba /></span>}
        />
        <div className="risk-stress-grid">
          {data.stress.map((scenario) => (
            <article className="risk-stress-card" key={scenario.key}>
              <div className="risk-kicker">{scenario.label}</div>
              <h3>{scenario.entities}</h3>
              <div className="risk-stress-loss">{formatMoney(scenario.loss, hidden)}</div>
              <div className="risk-stress-meta">
                <span>Impacto no PL</span>
                <strong>{scenario.impactPl === null ? "TBA" : formatPercent(scenario.impactPl)}</strong>
              </div>
              <div className="risk-stress-meta">
                <span>PL remanescente</span>
                <strong>{data.patrimonio > 0 ? formatMoney(Math.max(0, data.patrimonio - scenario.loss), hidden, true) : "TBA"}</strong>
              </div>
            </article>
          ))}
          <article className="risk-stress-card risk-stress-tba">
            <div className="risk-kicker">Próxima evolução</div>
            <h3>Stress de liquidez e funding</h3>
            <Tba detail="Depende do cronograma de obrigações, funding e covenants" />
            <p>Cronograma de obrigações, caixa mínimo, custo do funding e covenants serão adicionados no Supabase.</p>
          </article>
        </div>
      </section>
    </div>
  );
}

function formatWorkflowValue(value, unit, hidden = false) {
  return unit === "currency" ? formatMoney(value, hidden, true) : formatPercent(Number(value));
}

function createWorkflowSignature(data, limits) {
  return JSON.stringify({
    limits: limits.map((limit) => [limit.metric_key, limit.warning_value, limit.critical_value, limit.enabled]),
    metrics: getRiskMetricSnapshots(data).map((metric) => [metric.key, Number(metric.value).toFixed(8), metric.entityKey]),
  });
}

function ActionRow({ alert, action, definition, hidden }) {
  /* Campos operacionais preservados para uma atualização futura.
  const [responsible, setResponsible] = useState(action?.responsible || "");
  const [dueDate, setDueDate] = useState(action?.due_date || "");
  const [status, setStatus] = useState(action?.status || "pending");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setResponsible(action?.responsible || "");
    setDueDate(action?.due_date || "");
    setStatus(action?.status || "pending");
  }, [action]);

  async function save(onUpdate) {
    if (!action?.id) return;
    setSaving(true);
    try {
      await onUpdate(action.id, {
        responsible: responsible.trim() || null,
        due_date: dueDate || null,
        status,
      });
    } finally {
      setSaving(false);
    }
  }
  */

  return (
    <tr>
      <td><span className={`risk-level risk-level-${alert.level === "critical" ? "red" : "amber"}`}>{alert.level === "critical" ? "Crítico" : "Atenção"}</span></td>
      <td><strong>{alert.title}</strong></td>
      <td>{alert.entity_label || "Carteira"}</td>
      <td>{formatWorkflowValue(alert.current_value, definition?.unit, hidden)}</td>
      <td className="risk-action-description">{action?.description || definition?.action}</td>
      {/* Campos Responsável, Prazo, Status e Salvar mantidos comentados para evolução futura.
      <td><input className="risk-inline-input" value={responsible} onChange={(event) => setResponsible(event.target.value)} placeholder="Definir" /></td>
      <td><input className="risk-inline-input" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></td>
      <td><select className="risk-inline-input" value={status} onChange={(event) => setStatus(event.target.value)} /></td>
      <td><button className="risk-row-save" type="button" onClick={save}>Salvar</button></td>
      */}
    </tr>
  );
}

function LimitsView({ data, hidden, limits, alerts, actions, onOpenLimits }) {
  const snapshots = getRiskMetricSnapshots(data);
  const limitsByKey = new Map(limits.map((limit) => [limit.metric_key, limit]));
  const definitionsByKey = new Map(RISK_LIMIT_DEFINITIONS.map((definition) => [definition.key, definition]));
  const activeAlerts = alerts.filter((alert) => alert.status !== "resolved");
  const activeAlertIds = new Set(activeAlerts.map((alert) => alert.id));
  const actionsByAlert = new Map(actions.map((action) => [action.alert_id, action]));

  const limitStatus = (snapshot, limit, definition) => {
    if (!limit) return { label: "Não configurado", tone: "neutral" };
    if (!limit.enabled) return { label: "Inativo", tone: "neutral" };
    const evaluation = evaluateRiskLimit(definition, snapshot.value, limit, data);
    if (evaluation.level === "critical") return { label: "Crítico", tone: "red", evaluation };
    if (evaluation.level === "attention") return { label: "Atenção", tone: "amber", evaluation };
    return { label: "Dentro do limite", tone: "green", evaluation };
  };

  return (
    <div className="risk-view-stack">
      <section className="risk-status-strip">
        <div><span className="risk-status-dot risk-status-red" /><strong>{activeAlerts.filter((item) => item.level === "critical").length}</strong><small>crítico(s)</small></div>
        <div><span className="risk-status-dot risk-status-amber" /><strong>{activeAlerts.filter((item) => item.level === "attention").length}</strong><small>atenção</small></div>
        <div><span className="risk-status-dot risk-status-neutral" /><strong>{actions.filter((item) => activeAlertIds.has(item.alert_id) && ["pending", "in_progress"].includes(item.status)).length}</strong><small>providência(s) aberta(s)</small></div>
        <div><span className="risk-status-dot risk-status-tba" /><strong>{limits.filter((item) => item.enabled).length}</strong><small>limite(s) ativo(s)</small></div>
      </section>

      <section className="risk-panel">
        <SectionHeader
          kicker="Apetite de risco"
          title="Limites e situação"
          description="Defina faixas de atenção e criticidade. A configuração é compartilhada e salva no Supabase."
          aside={<button className="risk-config-button" type="button" onClick={onOpenLimits}>Configurar limites</button>}
        />
        <div className="risk-table-wrap">
          <table className="risk-table">
            <thead><tr><th>Indicador</th><th>Valor atual</th><th>Limite aprovado</th><th>Situação</th>{/* <th>Fonte</th> */}</tr></thead>
            <tbody>
              {snapshots.map((snapshot) => {
                const limit = limitsByKey.get(snapshot.key);
                const definition = definitionsByKey.get(snapshot.key);
                const status = limitStatus(snapshot, limit, definition);
                const derivedTarget = definition?.thresholdFormula === "ticketOverPl" && limit?.unit === "currency"
                  ? deriveHhiTarget(limit.warning_value, data.patrimonio)
                  : null;
                const limitDisplay = !limit
                  ? <Tba detail="Clique em Configurar limites" />
                  : derivedTarget
                    ? <span className="risk-limit-pair">Ticket {formatMoney(derivedTarget.ticket, hidden, true)}<small>HHI máximo {formatHhi(derivedTarget.hhi)} · N objetivo {derivedTarget.effectiveNames.toFixed(1).replace(".", ",")}</small></span>
                    : definition?.alertMode === "attentionOnly"
                      ? <span className="risk-limit-pair">Atenção {formatWorkflowValue(limit.warning_value, limit.unit, hidden)}</span>
                      : definition?.alertMode === "criticalOnly"
                        ? <span className="risk-limit-pair">Crítico {formatWorkflowValue(limit.critical_value, limit.unit, hidden)}</span>
                        : <span className="risk-limit-pair">Atenção {formatWorkflowValue(limit.warning_value, limit.unit, hidden)}<small>Crítico {formatWorkflowValue(limit.critical_value, limit.unit, hidden)}</small></span>;
                return (
                  <tr key={snapshot.key}>
                    <td><strong>{snapshot.label}</strong></td>
                    <td>{formatWorkflowValue(snapshot.value, snapshot.unit, hidden)}</td>
                    <td>{limitDisplay}</td>
                    <td><span className={`risk-limit-status risk-limit-status-${status.tone}`}>{status.label}{limit?.enabled ? ` · ${formatWorkflowValue(snapshot.value, snapshot.unit, hidden)}` : ""}</span></td>
                    {/* <td>{limit ? "Supabase" : "Calculado"}</td> */}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="risk-panel">
        <SectionHeader
          kicker="Fila de tratamento"
          title="Alertas e providências"
          description="Os alertas são gerados pelos limites ativos e vinculados às providências recomendadas."
        />
        <div className="risk-table-wrap">
          <table className="risk-table risk-actions-table">
            <thead><tr><th>Nível</th><th>Alerta</th><th>Entidade</th><th>Indicador</th><th>Providência</th>{/* <th>Responsável</th><th>Prazo</th><th>Status</th><th /> */}</tr></thead>
            <tbody>
              {activeAlerts.map((alert) => (
                <ActionRow
                  key={alert.id}
                  alert={alert}
                  action={actionsByAlert.get(alert.id)}
                  definition={definitionsByKey.get(alert.metric_key)}
                  hidden={hidden}
                />
              ))}
              {activeAlerts.length === 0 && <tr><td className="risk-empty-cell" colSpan="5">Nenhum alerta ativo. Configure os limites para iniciar o monitoramento.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function RiskLimitsModal({ limits, patrimonio, saving, error, onClose, onSave }) {
  const existingByKey = new Map(limits.map((limit) => [limit.metric_key, limit]));
  const [drafts, setDrafts] = useState(() => Object.fromEntries(
    RISK_LIMIT_DEFINITIONS.map((definition) => {
      const existing = existingByKey.get(definition.key);
      const inputUnit = definition.inputUnit || definition.unit;
      const compatibleExisting = existing?.unit === inputUnit ? existing : null;
      return [definition.key, {
        enabled: existing?.enabled ?? true,
        warning: definition.alertMode === "criticalOnly"
          ? ""
          : compatibleExisting ? limitToInputValue(compatibleExisting.warning_value, inputUnit) : definition.suggestedWarning,
        critical: definition.alertMode === "attentionOnly"
          ? ""
          : compatibleExisting ? limitToInputValue(compatibleExisting.critical_value, inputUnit) : definition.suggestedCritical,
      }];
    }),
  ));

  const updateDraft = (key, patch) => {
    setDrafts((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  };

  return (
    <div className="risk-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="risk-modal" role="dialog" aria-modal="true" aria-labelledby="risk-limits-title">
        <header className="risk-modal-header">
          <div>
            <div className="risk-kicker">Política compartilhada</div>
            <h2 id="risk-limits-title">Configurar limites de risco</h2>
            <p>PL alocável atual: <strong>{formatMoney(patrimonio, false)}</strong>. Para cedentes e sacados, informe o ticket médio alvo; o sistema calcula automaticamente N objetivo e HHI máximo.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">×</button>
        </header>

        <div className="risk-limit-form-head"><span>Indicador</span><span>Atenção / Meta</span><span>Crítico</span></div>
        <div className="risk-limit-form-list">
          {RISK_LIMIT_DEFINITIONS.map((definition) => {
            const draft = drafts[definition.key];
            const inputUnit = definition.inputUnit || definition.unit;
            const hhiTarget = definition.thresholdFormula === "ticketOverPl"
              ? deriveHhiTarget(draft.warning, patrimonio)
              : null;
            const renderInput = (field, accessibleLabel) => (
              <label>
                <span className="risk-sr-only">{accessibleLabel} para {definition.configLabel || definition.label}</span>
                <div className="risk-number-field">
                  {inputUnit === "currency" && <b>R$</b>}
                  <input type="number" min="0" step={inputUnit === "currency" ? "1000" : "0.1"} value={draft[field]} onChange={(event) => updateDraft(definition.key, { [field]: event.target.value })} />
                  {inputUnit !== "currency" && <b>%</b>}
                </div>
              </label>
            );
            return (
              <div className={`risk-limit-form-row ${draft.enabled ? "" : "is-disabled"}`} key={definition.key}>
                <label className="risk-limit-toggle">
                  <input type="checkbox" checked={draft.enabled} onChange={(event) => updateDraft(definition.key, { enabled: event.target.checked })} />
                  <span>
                    <strong>{definition.configLabel || definition.label}</strong>
                    <small>{definition.action}</small>
                    {hhiTarget && <small className="risk-derived-target">N objetivo {hhiTarget.effectiveNames.toFixed(1).replace(".", ",")} · HHI máximo {formatHhi(hhiTarget.hhi)}</small>}
                  </span>
                </label>
                {definition.alertMode === "criticalOnly"
                  ? <div className="risk-limit-not-applicable">—</div>
                  : renderInput("warning", definition.thresholdFormula === "ticketOverPl" ? "Ticket médio alvo" : "Atenção")}
                {definition.alertMode === "attentionOnly"
                  ? <div className="risk-limit-not-applicable">—</div>
                  : renderInput("critical", "Crítico")}
              </div>
            );
          })}
        </div>

        {error && <div className="risk-modal-error">{error}</div>}
        <footer className="risk-modal-footer">
          <button className="risk-secondary-button" type="button" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="risk-config-button" type="button" onClick={() => onSave(drafts)} disabled={saving}>{saving ? "Salvando e gerando alertas..." : "Salvar limites"}</button>
        </footer>
      </section>
    </div>
  );
}

function RatingView({ data, hidden }) {
  const futureBlocks = [
    { name: "Histórico Lafer", weight: "Peso TBA", status: "Base disponível", detail: "Pontualidade, atraso, recompras, volume e concentração." },
    { name: "Capacidade financeira", weight: "Peso TBA", status: "TBA", detail: "Faturamento, margem, caixa, endividamento e alavancagem." },
    { name: "Serasa e SCR", weight: "Peso TBA", status: "TBA", detail: "Score, restrições, dívida total, vencidos e evolução." },
    { name: "Risco setorial", weight: "Peso TBA", status: "TBA", detail: "Ramo, câmbio, commodities, sazonalidade e região." },
    { name: "Jurídico e governança", weight: "Peso TBA", status: "TBA", detail: "Processos, quadro societário, tempo de atividade e controles." },
  ];

  return (
    <div className="risk-view-stack">
      <section className="risk-panel risk-rating-intro">
        <div>
          <div className="risk-kicker">Arquitetura preparada</div>
          <h2>Rating Interno do Cedente</h2>
          <p>O histórico comportamental já pode ser observado. A nota A–E permanecerá TBA até a aprovação dos pesos, regras impeditivas e fontes externas.</p>
        </div>
        <div className="risk-rating-placeholder">
          <span>Rating consolidado</span>
          <strong>TBA</strong>
          <small>Política e dados externos pendentes</small>
        </div>
      </section>

      <section>
        <SectionHeader
          kicker="Componentes"
          title="Blocos do modelo"
          description="A interface diferencia dados já disponíveis de informações que serão armazenadas no Supabase."
        />
        <div className="risk-rating-blocks">
          {futureBlocks.map((block) => (
            <article className={`risk-rating-block ${block.status === "TBA" ? "is-tba" : "is-ready"}`} key={block.name}>
              <div className="risk-card-title-row"><h3>{block.name}</h3><span>{block.weight}</span></div>
              <strong>{block.status}</strong>
              <p>{block.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="risk-panel">
        <SectionHeader
          kicker="Base comportamental"
          title="Histórico dos cedentes na Lafer"
          description="Visão preliminar calculada com liquidações, atrasos, recompras e exposição atual. Não representa ainda um rating de crédito."
          aside={<span className="risk-info-chip">Score 0–100 <Tba /></span>}
        />
        <div className="risk-table-wrap">
          <table className="risk-table risk-rating-table">
            <thead><tr><th>Cedente</th><th>Grupo</th><th>Exposição atual</th><th>Liquidados</th><th>Em dia</th><th>Atraso médio</th><th>Recompras</th><th>Rating</th></tr></thead>
            <tbody>
              {data.cedenteHistory.slice(0, 12).map((cedente) => (
                <tr key={cedente.key}>
                  <td><strong title={cedente.name}>{cedente.name}</strong><small>{cedente.titles} título(s) no histórico</small></td>
                  <td>{cedente.group}</td>
                  <td>{formatMoney(cedente.openExposure, hidden, true)}</td>
                  <td>{cedente.settled}</td>
                  <td>{cedente.onTimeRate === null ? <Tba detail="Sem liquidações com datas suficientes" /> : formatPercent(cedente.onTimeRate)}</td>
                  <td>{cedente.lateSettled > 0 ? `${cedente.averageLateDays.toFixed(0)} dias` : "—"}</td>
                  <td>{cedente.repurchases}</td>
                  <td><Tba detail="Aguardando política de rating" /></td>
                </tr>
              ))}
              {data.cedenteHistory.length === 0 && <tr><td colSpan="8" className="risk-empty-cell">Nenhum cedente disponível para análise.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="risk-future-data">
        <div><span>01</span><strong>Cadastro do cedente</strong><p>Setor, demonstrações, governança e dados jurídicos.</p></div>
        <div><span>02</span><strong>Fontes externas</strong><p>Serasa, SCR, consultas e evidências com data de validade.</p></div>
        <div><span>03</span><strong>Política de rating</strong><p>Pesos, faixas A–E, regras impeditivas e alçadas.</p></div>
        <div><span>04</span><strong>Histórico de decisões</strong><p>Versões do score, limites, exceções, responsáveis e justificativas.</p></div>
      </section>
    </div>
  );
}

export default function RiskDashboard({ session, hideValues, setHideValues }) {
  const [activeView, setActiveView] = useState("overview");
  const [rows, setRows] = useState([]);
  const [groups, setGroups] = useState([]);
  const [patrimonio, setPatrimonio] = useState(0);
  const [snapshotDate, setSnapshotDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [limits, setLimits] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [actions, setActions] = useState([]);
  const [workflowReady, setWorkflowReady] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [workflowSaving, setWorkflowSaving] = useState(false);
  const [workflowError, setWorkflowError] = useState("");
  const [workflowNotice, setWorkflowNotice] = useState("");
  const syncSignatureRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [sourceResults, groupsResult, snapshotResult, workflowResult] = await Promise.all([
          Promise.all(SOURCE_TABLES.map(fetchAllRows)),
          supabase.from("grupos_economicos").select("id,nome,prefixos,ativo").eq("ativo", true).order("nome"),
          supabase.from("secSnapshots").select('Data,Recebiveis,"Dinheiro Banco"').order("Data", { ascending: false }).limit(1),
          loadRiskWorkflow(),
        ]);
        if (cancelled) return;
        if (groupsResult.error) console.warn("Grupos econômicos indisponíveis:", groupsResult.error.message);
        if (snapshotResult.error) console.warn("Snapshot patrimonial indisponível:", snapshotResult.error.message);

        const normalizedRows = sourceResults.flatMap((sourceRows, sourceIndex) =>
          (sourceRows || []).map((row, index) => normalizeRow(row, SOURCE_TABLES[sourceIndex], index)),
        );
        const latestSnapshot = snapshotResult.data?.[0];
        setRows(normalizedRows);
        setGroups((groupsResult.data || []).map(normalizeGroup));
        setPatrimonio(latestSnapshot
          ? parseNumber(latestSnapshot.Recebiveis) + parseNumber(latestSnapshot["Dinheiro Banco"])
          : 0);
        setSnapshotDate(latestSnapshot?.Data || "");
        setLimits(workflowResult.limits);
        setAlerts(workflowResult.alerts);
        setActions(workflowResult.actions);
        setWorkflowReady(true);
      } catch (loadError) {
        if (!cancelled) setError(loadError?.message || "Não foi possível carregar a análise de riscos.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const data = useMemo(() => {
    const eligibleRows = rows.filter((row) => isValidPortfolioRow(row) && row.Entrada > 0);
    const allRows = applyPortfolioStatuses(eligibleRows);
    const openRows = allRows.filter((row) => ["aVencer", "atraso"].includes(row._status));
    const totalOpen = openRows.reduce((sum, row) => sum + row.Entrada, 0);
    const sacados = aggregateExposure(openRows, (row) => ({ key: entityKey(row.Sacado), label: displayEntity(row.Sacado) }));
    const grouped = aggregateExposure(openRows, (row) => {
      const group = findEconomicGroup(row.Cliente, groups);
      return group
        ? { key: `group:${group.id || entityKey(group.label)}`, label: group.label }
        : { key: `standalone:${entityKey(row.Cliente)}`, label: `${displayEntity(row.Cliente)} · individual` };
    });
    const sacadoStats = concentrationStats(sacados, totalOpen, patrimonio);
    const cedenteStats = concentrationStats(grouped, totalOpen, patrimonio);
    const stressTop1 = sacados.slice(0, 1);
    const stressTop2 = sacados.slice(0, 2);
    const makeStress = (key, label, items) => {
      const loss = items.reduce((sum, item) => sum + item.value, 0);
      return {
        key,
        label,
        loss,
        impactPl: patrimonio > 0 ? loss / patrimonio : null,
        entities: items.map((item) => item.label).join(" + ") || "Sem dados",
      };
    };

    return {
      allRows,
      openRows,
      totalOpen,
      patrimonio,
      cedenteStats,
      sacadoStats,
      delinquency: buildDelinquency(openRows),
      trend: buildMonthlyTrend(allRows, groups),
      cedenteHistory: buildCedenteHistory(allRows, openRows, groups),
      stress: [
        makeStress("top1", "Default do maior sacado", stressTop1),
        makeStress("top2", "Default dos dois maiores", stressTop2),
      ],
    };
  }, [rows, groups, patrimonio]);

  useEffect(() => {
    if (loading || !workflowReady || limits.length === 0) return undefined;
    const signature = createWorkflowSignature(data, limits);
    if (syncSignatureRef.current === signature) return undefined;
    syncSignatureRef.current = signature;
    let cancelled = false;

    syncRiskWorkflow(data, limits, session?.user?.id)
      .then((workflow) => {
        if (cancelled) return;
        setAlerts(workflow.alerts);
        setActions(workflow.actions);
      })
      .catch((syncError) => {
        if (!cancelled) setWorkflowError(syncError?.message || "Não foi possível atualizar os alertas.");
      });

    return () => { cancelled = true; };
  }, [data, limits, loading, session?.user?.id, workflowReady]);

  async function handleSaveLimits(drafts) {
    setWorkflowSaving(true);
    setWorkflowError("");
    setWorkflowNotice("");
    try {
      const savedLimits = await saveRiskLimits(drafts, session?.user?.id);
      const workflow = await syncRiskWorkflow(data, savedLimits, session?.user?.id);
      syncSignatureRef.current = createWorkflowSignature(data, savedLimits);
      setLimits(savedLimits);
      setAlerts(workflow.alerts);
      setActions(workflow.actions);
      setLimitsOpen(false);
      setWorkflowNotice("Limites salvos. Alertas e providências atualizados.");
    } catch (saveError) {
      setWorkflowError(saveError?.message || "Não foi possível salvar os limites.");
    } finally {
      setWorkflowSaving(false);
    }
  }

  async function handleUpdateAction(actionId, patch) {
    setWorkflowError("");
    setWorkflowNotice("");
    try {
      const updated = await updateRiskAction(actionId, patch, session?.user?.id);
      setActions((current) => current.map((action) => action.id === updated.id ? updated : action));
      setWorkflowNotice("Providência atualizada.");
    } catch (updateError) {
      setWorkflowError(updateError?.message || "Não foi possível atualizar a providência.");
    }
  }

  if (loading) {
    return <div className="risk-loading"><span /><strong>Preparando a visão de riscos...</strong><p>Calculando exposição, concentração e comportamento da carteira.</p></div>;
  }

  if (error) {
    return <div className="risk-error"><strong>Não foi possível carregar Riscos e Alertas</strong><p>{error}</p></div>;
  }

  const snapshotLabel = snapshotDate && parseDate(snapshotDate)
    ? new Intl.DateTimeFormat("pt-BR").format(parseDate(snapshotDate))
    : "TBA";

  return (
    <main className="risk-dashboard">
      <header className="risk-hero">
        <div>
          <div className="risk-hero-kicker">Gestão Integrada de Riscos</div>
          <h1>Riscos e Alertas</h1>
          <p>Concentração, comportamento, limites e decisões preventivas em uma visão única da carteira.</p>
        </div>
        <div className="risk-hero-meta">
          <div><span>Base analisada</span><strong>{data.allRows.length.toLocaleString("pt-BR")} títulos</strong></div>
          <div><span>Snapshot do PL</span><strong>{snapshotLabel}</strong></div>
          <button type="button" onClick={() => setHideValues((current) => !current)} aria-label={hideValues ? "Mostrar valores" : "Ocultar valores"}>
            {hideValues ? "Mostrar valores" : "Ocultar valores"}
          </button>
        </div>
      </header>

      <nav className="risk-subnav" aria-label="Seções de riscos">
        <button type="button" className={activeView === "overview" ? "is-active" : ""} onClick={() => setActiveView("overview")}>Visão Geral</button>
        <button type="button" className={activeView === "limits" ? "is-active" : ""} onClick={() => setActiveView("limits")}>Limites e Alertas</button>
        <button type="button" className={activeView === "rating" ? "is-active" : ""} onClick={() => setActiveView("rating")}>Rating Interno</button>
      </nav>

      {workflowNotice && <div className="risk-workflow-notice risk-workflow-notice-success">{workflowNotice}</div>}
      {workflowError && !limitsOpen && <div className="risk-workflow-notice risk-workflow-notice-error">{workflowError}</div>}

      {activeView === "overview" && <OverviewView data={data} hidden={hideValues} limits={limits} alerts={alerts} />}
      {activeView === "limits" && <LimitsView data={data} hidden={hideValues} limits={limits} alerts={alerts} actions={actions} onOpenLimits={() => { setWorkflowError(""); setLimitsOpen(true); }} onUpdateAction={handleUpdateAction} />}
      {activeView === "rating" && <RatingView data={data} hidden={hideValues} />}

      {limitsOpen && <RiskLimitsModal limits={limits} patrimonio={data.patrimonio} saving={workflowSaving} error={workflowError} onClose={() => { if (!workflowSaving) setLimitsOpen(false); }} onSave={handleSaveLimits} />}
    </main>
  );
}
