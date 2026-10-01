import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import { isRiskCedenteVisible, loadRiskDelayCedentes, loadRiskDelayHistory } from "./riskDelayHistory";
import "./RiskDelayHistoryChart.css";

const percent = (value) => value === null ? "Sem exposição em aberto" : `${(value * 100).toFixed(2).replace(".", ",")}%`;
const dateLabel = (value) => value.split("-").reverse().join("/");
const timestamp = (day) => Date.parse(`${day}T12:00:00Z`);
const money = (value, hidden) => hidden ? "R$ ••••••" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

export default function RiskDelayHistoryChart({ hidden, cedentes = [] }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [range, setRange] = useState("90");
  const [selected, setSelected] = useState(null);
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
  const active = visible.find((row) => row.data_referencia === selected) || visible.at(-1);
  const valid = visible.filter((row) => row.percentual_atraso !== null);
  const yMax = Math.min(1, Math.max(0.05, Math.ceil(Math.max(...valid.map((row) => row.percentual_atraso), 0) * 1.15 * 20) / 20));
  const start = visible[0] ? timestamp(visible[0].data_referencia) : 0;
  const end = last ? timestamp(last.data_referencia) : 0;
  const plotRight = chartWidth - 25;
  const x = (row) => end === start ? (70 + plotRight) / 2 : 70 + (timestamp(row.data_referencia) - start) / (end - start) * (plotRight - 70);
  const y = (row) => 235 - row.percentual_atraso / yMax * 200;
  // Dias sem atualização não ganham pontos; exposição zero interrompe a linha.
  const path = visible.map((row, index) => {
    if (row.percentual_atraso === null) return "";
    const command = index > 0 && visible[index - 1].percentual_atraso !== null ? "L" : "M";
    return `${command}${x(row)},${y(row)}`;
  }).join(" ");

  return <section className="risk-panel risk-delay-history" ref={chartContainer}>
    <div className="risk-delay-heading">
      <div><div className="risk-kicker">Evolução da carteira</div><h3>Histórico do percentual de atraso</h3>
        <p>Exposição vencida ÷ exposição em aberto.</p></div>
      <div className="risk-delay-filters"><label>Período <select value={range} onChange={(event) => { setRange(event.target.value); setSelected(null); }}>
        <option value="30">30 dias</option><option value="90">90 dias</option><option value="all">Todo o histórico</option>
      </select></label>
      <label>Carteira / cedente <select value={activeCedenteKey} onChange={(event) => {
        setCedenteKey(event.target.value); setHistory([]); setLoading(true); setError(""); setSelected(null);
      }}>
        <option value="">Carteira</option>
        {options.map((item) => <option key={item.cedente_key} value={item.cedente_key}>{item.cedente}</option>)}
      </select></label></div>
    </div>
    {cedentesError && <p role="alert">Não foi possível carregar a lista completa de cedentes. <button className="risk-config-button" onClick={() => setRevision((value) => value + 1)}>Tentar novamente</button></p>}
    {loading ? <p role="status">Carregando histórico…</p> : error ? <div role="alert"><p>Não foi possível carregar o histórico: {error}</p>
      <button className="risk-config-button" onClick={() => { setLoading(true); setRevision((value) => value + 1); }}>Tentar novamente</button></div>
      : !last ? <p className="risk-delay-empty">{activeCedenteKey ? "Este cedente ainda não tem registros. O histórico por cedente começa na próxima atualização da base." : "O histórico começa na próxima atualização da base. Dias sem atualização não terão registro."}</p> : <>
        {valid.length > 0 ? <svg className="risk-delay-chart" viewBox={`0 0 ${chartWidth} 290`} role="group" aria-label={`Evolução do percentual de atraso: ${seriesLabel}`}>
          {[0, 1, 2, 3, 4].map((tick) => <g key={tick}>
            <line x1="70" x2={plotRight} y1={235 - tick * 50} y2={235 - tick * 50} stroke="#e2e8f0" />
            <text x="60" y={240 - tick * 50} textAnchor="end">{(yMax * tick / 4 * 100).toFixed(1).replace(".", ",")}%</text>
          </g>)}
          <path d={path} fill="none" stroke="#6366f1" strokeWidth="3" />
          {valid.map((row) => <circle key={row.data_referencia} cx={x(row)} cy={y(row)} r={active?.data_referencia === row.data_referencia ? 6 : 4}
            fill="#6366f1" tabIndex="0" role="button" aria-label={`${dateLabel(row.data_referencia)}: ${percent(row.percentual_atraso)}`}
            onMouseEnter={() => setSelected(row.data_referencia)} onFocus={() => setSelected(row.data_referencia)} onClick={() => setSelected(row.data_referencia)}
            onKeyDown={(event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); setSelected(row.data_referencia); } }}>
            <title>{dateLabel(row.data_referencia)} · {percent(row.percentual_atraso)}</title>
          </circle>)}
          <text x="70" y="268">{dateLabel(visible[0].data_referencia)}</text>
          {end !== start && <text x={plotRight} y="268" textAnchor="end">{dateLabel(last.data_referencia)}</text>}
        </svg> : <p className="risk-delay-empty">Os registros deste período não têm exposição em aberto.</p>}
        <details><summary>Ver registros do período ({visible.length})</summary><div className="risk-table-wrap"><table className="risk-table">
          <thead><tr><th>Data</th><th>Percentual de atraso</th><th>Exposição vencida</th><th>Exposição em aberto</th></tr></thead>
          <tbody>{[...visible].reverse().map((row) => <tr key={row.data_referencia}><td>{dateLabel(row.data_referencia)}</td><td>{percent(row.percentual_atraso)}</td><td>{money(row.exposicao_vencida, hidden)}</td><td>{money(row.exposicao_aberto, hidden)}</td></tr>)}</tbody>
        </table></div></details>
      </>}
  </section>;
}
