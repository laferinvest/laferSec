import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import { isRiskCedenteVisible, loadRiskDelayCedentes, loadRiskDelayHistory } from "./riskDelayHistory";
import { historyDaySpan, historyMarkerRows, historyPointInterval, historyTimestamp as timestamp, spacedHistoryRows } from "./riskDelayChartModel.js";
import "./RiskDelayHistoryChart.css";

const percent = (value) => value === null ? "Sem exposição em aberto" : `${(value * 100).toFixed(2).replace(".", ",")}%`;
const dateLabel = (value) => value.split("-").reverse().join("/");
const money = (value, hidden) => hidden ? "R$ ••••••" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

export function RiskDelayHistoryPlot({ rows, chartWidth, seriesLabel }) {
  const [selected, setSelected] = useState(null);
  const valid = rows.filter((row) => row.percentual_atraso !== null);
  if (!valid.length) return <p className="risk-delay-empty">Os registros deste período não têm exposição em aberto.</p>;
  const width = Math.max(chartWidth, 200);
  const active = valid.find((row) => row.data_referencia === selected);
  const yMax = Math.min(1, Math.max(0.05, Math.ceil(Math.max(...valid.map((row) => row.percentual_atraso), 0) * 1.15 * 20) / 20));
  const start = timestamp(rows[0].data_referencia);
  const end = timestamp(rows.at(-1).data_referencia);
  const plotRight = width - 25;
  const x = (row) => end === start ? (70 + plotRight) / 2 : 70 + (timestamp(row.data_referencia) - start) / (end - start) * (plotRight - 70);
  const y = (row) => 235 - row.percentual_atraso / yMax * 200;
  const days = historyDaySpan(rows);
  const markers = historyMarkerRows(rows, historyPointInterval(days));
  const labelCount = Math.max(2, Math.floor((plotRight - 70) / 100) + 1);
  const axisRows = spacedHistoryRows(rows, Math.max(1, Math.ceil((days - 1) / (labelCount - 1))));
  // A curva e as áreas de interação mantêm todos os registros, mesmo entre os dots.
  const path = rows.map((row, index) => {
    if (row.percentual_atraso === null) return "";
    return `${index > 0 && rows[index - 1].percentual_atraso !== null ? "L" : "M"}${x(row)},${y(row)}`;
  }).join(" ");
  const tooltipX = active ? Math.max(8, Math.min(x(active) - 75, width - 158)) : 0;
  const tooltipY = active ? y(active) > 80 ? y(active) - 64 : y(active) + 14 : 0;

  return <svg className="risk-delay-chart" viewBox={`0 0 ${width} 290`} role="group" aria-label={`Evolução do percentual de atraso: ${seriesLabel}`} onMouseLeave={() => setSelected(null)}>
    {[0, 1, 2, 3, 4].map((tick) => <g key={tick}>
      <line x1="70" x2={plotRight} y1={235 - tick * 50} y2={235 - tick * 50} stroke="#e2e8f0" />
      <text x="60" y={240 - tick * 50} textAnchor="end">{(yMax * tick / 4 * 100).toFixed(1).replace(".", ",")}%</text>
    </g>)}
    <path d={path} fill="none" stroke="#4f46e5" strokeWidth="3" strokeLinejoin="round" />
    {markers.map((row) => <circle className="risk-delay-dot" key={row.data_referencia} cx={x(row)} cy={y(row)} r="3.5"
      fill="#4f46e5" stroke="#fff" strokeWidth="1.5" tabIndex="0" role="button" aria-label={`${dateLabel(row.data_referencia)}: ${percent(row.percentual_atraso)}`}
      onMouseEnter={() => setSelected(row.data_referencia)} onFocus={() => setSelected(row.data_referencia)} onBlur={() => setSelected(null)} onClick={() => setSelected(row.data_referencia)}
      onKeyDown={(event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); setSelected(row.data_referencia); } }} />)}
    {axisRows.map((row, index) => <text key={row.data_referencia} x={x(row)} y="268" textAnchor={axisRows.length === 1 ? "middle" : index === 0 ? "start" : index === axisRows.length - 1 ? "end" : "middle"}>{dateLabel(row.data_referencia)}</text>)}
    {rows.map((row, index) => {
      if (row.percentual_atraso === null) return null;
      const left = index === 0 ? 70 : (x(rows[index - 1]) + x(row)) / 2;
      const right = index === rows.length - 1 ? plotRight : (x(row) + x(rows[index + 1])) / 2;
      return <rect className="risk-delay-hit-area" key={row.data_referencia} x={left} y="35" width={right - left} height="200" fill="transparent" aria-hidden="true"
        onMouseEnter={() => setSelected(row.data_referencia)} onMouseMove={() => setSelected(row.data_referencia)} onMouseLeave={() => setSelected(null)} onClick={() => setSelected(row.data_referencia)} />;
    })}
    {active && <g className="risk-delay-hover" aria-hidden="true">
      <line x1={x(active)} y1="35" x2={x(active)} y2="235" stroke="#9ca3af" strokeWidth="1" strokeDasharray="4 4" />
      <circle cx={x(active)} cy={y(active)} r="5" fill="#fff" stroke="#4f46e5" strokeWidth="2" />
      <rect x={tooltipX} y={tooltipY} width="150" height="50" rx="5" fill="#111827" opacity="0.94" />
      <text className="risk-delay-tooltip-date" x={tooltipX + 75} y={tooltipY + 19} textAnchor="middle">{dateLabel(active.data_referencia)}</text>
      <text className="risk-delay-tooltip-value" x={tooltipX + 75} y={tooltipY + 38} textAnchor="middle">{percent(active.percentual_atraso)}</text>
    </g>}
  </svg>;
}

export default function RiskDelayHistoryChart({ hidden, cedentes = [] }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [range, setRange] = useState("90");
  const [cedenteKey, setCedenteKey] = useState("");
  const [savedCedentes, setSavedCedentes] = useState([]);
  const [cedentesError, setCedentesError] = useState("");
  const chartContainer = useRef(null);
  const [chartWidth, setChartWidth] = useState(940);
  const activeCedenteKey = isRiskCedenteVisible({ cedente_key: cedenteKey }) ? cedenteKey : "";

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setChartWidth(Math.max(entry.contentRect.width, 1)));
    observer.observe(chartContainer.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadRiskDelayCedentes(supabase).then((options) => {
      if (!cancelled) { setSavedCedentes(options); setCedentesError(""); }
    }).catch((err) => { if (!cancelled) setCedentesError(err.message); });
    return () => { cancelled = true; };
  }, [revision]);

  useEffect(() => {
    let cancelled = false;
    loadRiskDelayHistory(supabase, activeCedenteKey).then((rows) => {
      if (!cancelled) { setHistory(rows); setError(""); }
    }).catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [revision, activeCedenteKey]);

  const options = [...new Map([...savedCedentes, ...cedentes].map((item) => [item.cedente_key, item])).values()]
    .filter(isRiskCedenteVisible)
    .sort((a, b) => a.cedente.localeCompare(b.cedente, "pt-BR"));
  const seriesLabel = options.find((item) => item.cedente_key === activeCedenteKey)?.cedente || "Carteira";

  const last = history.at(-1);
  const cutoff = last && range !== "all" ? timestamp(last.data_referencia) - (Number(range) - 1) * 86400000 : -Infinity;
  const visible = history.filter((row) => timestamp(row.data_referencia) >= cutoff);

  return <section className="risk-panel risk-delay-history" ref={chartContainer}>
    <div className="risk-delay-heading">
      <div><div className="risk-kicker">Evolução da carteira</div><h3>Histórico do percentual de atraso</h3>
        <p>Exposição vencida ÷ exposição em aberto.</p></div>
      <div className="risk-delay-filters"><label>Período <select value={range} onChange={(event) => setRange(event.target.value)}>
        <option value="30">30 dias</option><option value="60">60 dias</option><option value="90">90 dias</option><option value="all">Todo o histórico</option>
      </select></label>
      <label>Carteira / cedente <select value={activeCedenteKey} onChange={(event) => {
        setCedenteKey(event.target.value); setHistory([]); setLoading(true); setError("");
      }}>
        <option value="">Carteira</option>
        {options.map((item) => <option key={item.cedente_key} value={item.cedente_key}>{item.cedente}</option>)}
      </select></label></div>
    </div>
    {cedentesError && <p role="alert">Não foi possível carregar a lista completa de cedentes. <button className="risk-config-button" onClick={() => setRevision((value) => value + 1)}>Tentar novamente</button></p>}
    {loading ? <p role="status">Carregando histórico…</p> : error ? <div role="alert"><p>Não foi possível carregar o histórico: {error}</p>
      <button className="risk-config-button" onClick={() => { setLoading(true); setRevision((value) => value + 1); }}>Tentar novamente</button></div>
      : !last ? <p className="risk-delay-empty">{activeCedenteKey ? "Este cedente ainda não tem registros. O histórico por cedente começa na próxima atualização da base." : "O histórico começa na próxima atualização da base. Dias sem atualização não terão registro."}</p> : <>
        <RiskDelayHistoryPlot key={`${activeCedenteKey}/${range}`} rows={visible} chartWidth={chartWidth} seriesLabel={seriesLabel} />
        <details><summary>Ver registros do período ({visible.length})</summary><div className="risk-table-wrap"><table className="risk-table">
          <thead><tr><th>Data</th><th>Percentual de atraso</th><th>Exposição vencida</th><th>Exposição em aberto</th></tr></thead>
          <tbody>{[...visible].reverse().map((row) => <tr key={row.data_referencia}><td>{dateLabel(row.data_referencia)}</td><td>{percent(row.percentual_atraso)}</td><td>{money(row.exposicao_vencida, hidden)}</td><td>{money(row.exposicao_aberto, hidden)}</td></tr>)}</tbody>
        </table></div></details>
      </>}
  </section>;
}
