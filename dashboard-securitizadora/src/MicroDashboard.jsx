import { useEffect, useMemo, useState, useRef } from "react";
import { supabase } from "./supabaseClient";

// --- FUNÇÕES DE FORMATAÇÃO ---
function formatarData(dataString) {
  if (!dataString) return "";
  if (String(dataString).includes("/")) return dataString;
  const partes = String(dataString).split("T")[0].split("-");
  if (partes.length === 3) return `${partes[2]}/${partes[1]}/${partes[0]}`;
  return dataString;
}

function formatarMoeda(valor) {
  if (valor === null || valor === undefined || valor === "") return "";
  const numero = Number(valor);
  if (isNaN(numero)) return String(valor);
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(numero);
}

function escapeText(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

function formatarMesAno(ym) {
  if (!ym) return "";
  const [y, m] = ym.split('-');
  const monthsNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${monthsNames[parseInt(m, 10) - 1]}/${y}`;
}

const CEDENTES_IGNORADOS = ["12 -", "23 -", "2 -"];
function cedenteValido(cedente) {
  if (!cedente) return false;
  return !CEDENTES_IGNORADOS.some(ignorado => String(cedente).trim().startsWith(ignorado));
}
function sacadoValido(sacado) {
  if (!sacado) return false;
  const s = String(sacado).trim();
  return !(s === "0" || s.startsWith("0 -") || s.startsWith("0-"));
}

// --- COMPONENTE DE EVOLUÇÃO ---
function EvolutionCharts({ rows, chartFilter, setChartFilter, setBorderoFilter, setDctoFilter }) {
  const [hoveredIndex1, setHoveredIndex1] = useState(null);
  const [hoveredIndex2, setHoveredIndex2] = useState(null);

  const chartData = useMemo(() => {
    const grouped = {};
    rows.forEach(r => {
      const emisKey = Object.keys(r).find(k => k.toLowerCase().includes('emis'));
      const vctoKey = Object.keys(r).find(k => k.toLowerCase() === 'vcto' || (k.toLowerCase().includes('vcto') && !k.toLowerCase().includes('vl')));
      const valKey = Object.keys(r).find(k => k.toLowerCase() === 'entrada' || (k.toLowerCase().includes('valor') && !k.toLowerCase().includes('pgto')));
      
      if (emisKey && r[emisKey]) {
        const emisStr = String(r[emisKey]).split("T")[0];
        if (emisStr.length >= 7) {
          const ym = emisStr.substring(0, 7); 
          if (!grouped[ym]) grouped[ym] = { val: 0, numAtraso: 0, numTotalFin: 0 };
          const val = valKey ? (Number(r[valKey]) || 0) : 0;
          grouped[ym].val += val;
        }
      }

      if (vctoKey && r[vctoKey]) {
        const vctoStr = String(r[vctoKey]).split("T")[0];
        if (vctoStr.length >= 7) {
          const ym = vctoStr.substring(0, 7);
          if (!grouped[ym]) grouped[ym] = { val: 0, numAtraso: 0, numTotalFin: 0 };
          const s = r._status;
          if (s !== 'invalido' && s !== 'aVencer') {
            grouped[ym].numTotalFin += 1;
            if (s === 'liquidadoAtraso' || s === 'atraso' || s === 'recompra') {
              grouped[ym].numAtraso += 1;
            }
          }
        }
      }
    });

    const currentDate = new Date();
    const currentYM = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
    const sortedMonths = Object.keys(grouped).sort().filter(ym => ym <= currentYM);

    return sortedMonths.map(ym => {
      const obj = grouped[ym];
      return { ym, label: formatarMesAno(ym), value: obj.val, pctAtraso: obj.numTotalFin > 0 ? (obj.numAtraso / obj.numTotalFin) * 100 : 0 };
    });
  }, [rows]);

  if (chartData.length === 0) return null;

  const svgWidth = 600; const svgHeight = 240; 
  const paddingX = 50; const paddingRight = 20; const paddingTop = 30; const paddingBottom = 55; 
  const chartWidth = svgWidth - paddingX - paddingRight; const chartHeight = svgHeight - paddingTop - paddingBottom;
  const step = Math.ceil(chartData.length / 12); 

  const formatAxisVal = (val) => {
    if (val === 0) return '0';
    if (val >= 1000000) return Math.floor(val / 1000000) + 'M';
    if (val >= 1000) return Math.floor(val / 1000) + 'K';
    return Math.floor(val).toString();
  };
  const formatAxisPct = (val) => Math.floor(val) + '%';

  const maxVal1 = Math.max(...chartData.map(d => d.value), 10);
  const points1 = chartData.map((d, i) => {
    const x = chartData.length > 1 ? paddingX + (i / (chartData.length - 1)) * chartWidth : paddingX + chartWidth / 2;
    const y = svgHeight - paddingBottom - (d.value / maxVal1) * chartHeight;
    return { ...d, x, y };
  });
  const pathD1 = points1.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaD1 = points1.length > 1 ? `${pathD1} L ${points1[points1.length - 1].x} ${svgHeight - paddingBottom} L ${points1[0].x} ${svgHeight - paddingBottom} Z` : "";

  const maxVal2 = Math.max(...chartData.map(d => d.pctAtraso), 5); 
  const points2 = chartData.map((d, i) => {
    const x = chartData.length > 1 ? paddingX + (i / (chartData.length - 1)) * chartWidth : paddingX + chartWidth / 2;
    const y = svgHeight - paddingBottom - (d.pctAtraso / maxVal2) * chartHeight;
    return { ...d, x, y };
  });
  const pathD2 = points2.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaD2 = points2.length > 1 ? `${pathD2} L ${points2[points2.length - 1].x} ${svgHeight - paddingBottom} L ${points2[0].x} ${svgHeight - paddingBottom} Z` : "";

  return (
    <div style={{ marginBottom: "24px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "24px" }}>
        {/* GRÁFICO 1 */}
        <div style={{ flex: "1 1 400px", background: "#fff", padding: "24px", borderRadius: "12px", boxShadow: "0 1px 3px 0 rgba(0,0,0,0.1)" }}>
          <h3 style={{ margin: "0 0 16px 0", color: "#111827", fontSize: "16px", fontWeight: "600" }}>
            Evolução de Valores Descontados <span style={{fontSize: "12px", color:"#9ca3af", fontWeight: "400"}}>(clique num mês)</span>
          </h3>
          <div style={{ position: "relative", width: "100%", height: "auto" }}>
            <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ width: "100%", height: "auto", overflow: "visible" }}>
              <defs><linearGradient id="gradientArea1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4f46e5" stopOpacity="0.4" /><stop offset="100%" stopColor="#4f46e5" stopOpacity="0.0" /></linearGradient></defs>
              <line x1={paddingX} y1={paddingTop} x2={svgWidth - paddingRight} y2={paddingTop} stroke="#f3f4f6" strokeWidth="1" />
              <line x1={paddingX} y1={paddingTop + chartHeight / 2} x2={svgWidth - paddingRight} y2={paddingTop + chartHeight / 2} stroke="#f3f4f6" strokeWidth="1" />
              <line x1={paddingX} y1={svgHeight - paddingBottom} x2={svgWidth - paddingRight} y2={svgHeight - paddingBottom} stroke="#e5e7eb" strokeWidth="1" />
              <text x={paddingX - 8} y={paddingTop + 4} fill="#9ca3af" fontSize="11px" fontWeight="500" textAnchor="end">{formatAxisVal(maxVal1)}</text>
              <text x={paddingX - 8} y={paddingTop + chartHeight / 2 + 4} fill="#9ca3af" fontSize="11px" fontWeight="500" textAnchor="end">{formatAxisVal(maxVal1 / 2)}</text>
              <text x={paddingX - 8} y={svgHeight - paddingBottom + 4} fill="#9ca3af" fontSize="11px" fontWeight="500" textAnchor="end">0</text>
              {points1.length > 1 && <path d={areaD1} fill="url(#gradientArea1)" />}
              <path d={pathD1} fill="none" stroke="#4f46e5" strokeWidth="3" strokeLinejoin="round" />
              {points1.map((p, i) => {
                const isSelected = chartFilter?.type === 'emis' && chartFilter.month === p.ym;
                if (!isSelected) return null;
                return (
                  <g key={`selected1-${i}`}>
                    <line x1={p.x} y1={paddingTop} x2={p.x} y2={svgHeight - paddingBottom} stroke="#4f46e5" strokeWidth="2" strokeDasharray="4 4" />
                    <circle cx={p.x} cy={p.y} r="6" fill="#4f46e5" stroke="#fff" strokeWidth="2" />
                  </g>
                );
              })}
              {points1.map((p, i) => {
                if (i % step !== 0 && i !== points1.length - 1) return null;
                const isSelected = chartFilter?.type === 'emis' && chartFilter.month === p.ym;
                return (
                  <text key={`label1-${i}`} x={p.x} y={svgHeight - paddingBottom + 16} fill={isSelected ? "#4f46e5" : "#6b7280"} fontSize="11px" fontWeight={isSelected ? "700" : "400"} textAnchor="end" transform={`rotate(-45, ${p.x}, ${svgHeight - paddingBottom + 16})`}>{p.label}</text>
                );
              })}
              {hoveredIndex1 !== null && (
                <g>
                  <line x1={points1[hoveredIndex1].x} y1={paddingTop} x2={points1[hoveredIndex1].x} y2={svgHeight - paddingBottom} stroke="#9ca3af" strokeWidth="1" strokeDasharray="4 4" />
                  <circle cx={points1[hoveredIndex1].x} cy={points1[hoveredIndex1].y} r="5" fill="#fff" stroke="#4f46e5" strokeWidth="2" />
                  <rect x={points1[hoveredIndex1].x - 60} y={points1[hoveredIndex1].y - 35} width="120" height="26" rx="4" fill="#111827" opacity="0.9" />
                  <text x={points1[hoveredIndex1].x} y={points1[hoveredIndex1].y - 18} fill="#fff" fontSize="11px" fontWeight="600" textAnchor="middle">{formatarMoeda(points1[hoveredIndex1].value)}</text>
                </g>
              )}
              {points1.map((p, i) => {
                const segmentWidth = chartData.length > 1 ? chartWidth / (chartData.length - 1) : chartWidth;
                return (
                  <rect key={`interact1-${i}`} x={p.x - segmentWidth / 2} y={paddingTop} width={segmentWidth} height={chartHeight} fill="transparent"
                    onMouseEnter={() => setHoveredIndex1(i)} onMouseLeave={() => setHoveredIndex1(null)}
                    onClick={() => {
                      setChartFilter(prev => prev?.type === 'emis' && prev.month === p.ym ? null : { type: 'emis', month: p.ym });
                      setBorderoFilter(null); setDctoFilter(null);
                    }}
                    style={{ cursor: "pointer" }}
                  />
                );
              })}
            </svg>
          </div>
        </div>

        {/* GRÁFICO 2 */}
        <div style={{ flex: "1 1 400px", background: "#fff", padding: "24px", borderRadius: "12px", boxShadow: "0 1px 3px 0 rgba(0,0,0,0.1)" }}>
          <h3 style={{ margin: "0 0 16px 0", color: "#111827", fontSize: "16px", fontWeight: "600" }}>
            Percentual de Atraso <span style={{fontSize: "12px", color:"#9ca3af", fontWeight: "400"}}>(clique num mês)</span>
          </h3>
          <div style={{ position: "relative", width: "100%", height: "auto" }}>
            <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ width: "100%", height: "auto", overflow: "visible" }}>
              <defs><linearGradient id="gradientArea2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ef4444" stopOpacity="0.3" /><stop offset="100%" stopColor="#ef4444" stopOpacity="0.0" /></linearGradient></defs>
              <line x1={paddingX} y1={paddingTop} x2={svgWidth - paddingRight} y2={paddingTop} stroke="#f3f4f6" strokeWidth="1" />
              <line x1={paddingX} y1={paddingTop + chartHeight / 2} x2={svgWidth - paddingRight} y2={paddingTop + chartHeight / 2} stroke="#f3f4f6" strokeWidth="1" />
              <line x1={paddingX} y1={svgHeight - paddingBottom} x2={svgWidth - paddingRight} y2={svgHeight - paddingBottom} stroke="#e5e7eb" strokeWidth="1" />
              <text x={paddingX - 8} y={paddingTop + 4} fill="#9ca3af" fontSize="11px" fontWeight="500" textAnchor="end">{formatAxisPct(maxVal2)}</text>
              <text x={paddingX - 8} y={paddingTop + chartHeight / 2 + 4} fill="#9ca3af" fontSize="11px" fontWeight="500" textAnchor="end">{formatAxisPct(maxVal2 / 2)}</text>
              <text x={paddingX - 8} y={svgHeight - paddingBottom + 4} fill="#9ca3af" fontSize="11px" fontWeight="500" textAnchor="end">0%</text>
              {points2.length > 1 && <path d={areaD2} fill="url(#gradientArea2)" />}
              <path d={pathD2} fill="none" stroke="#ef4444" strokeWidth="3" strokeLinejoin="round" />
              {points2.map((p, i) => {
                const isSelected = chartFilter?.type === 'vcto' && chartFilter.month === p.ym;
                if (!isSelected) return null;
                return (
                  <g key={`selected2-${i}`}>
                    <line x1={p.x} y1={paddingTop} x2={p.x} y2={svgHeight - paddingBottom} stroke="#ef4444" strokeWidth="2" strokeDasharray="4 4" />
                    <circle cx={p.x} cy={p.y} r="6" fill="#ef4444" stroke="#fff" strokeWidth="2" />
                  </g>
                );
              })}
              {points2.map((p, i) => {
                if (i % step !== 0 && i !== points2.length - 1) return null;
                const isSelected = chartFilter?.type === 'vcto' && chartFilter.month === p.ym;
                return (
                  <text key={`label2-${i}`} x={p.x} y={svgHeight - paddingBottom + 16} fill={isSelected ? "#ef4444" : "#6b7280"} fontSize="11px" fontWeight={isSelected ? "700" : "400"} textAnchor="end" transform={`rotate(-45, ${p.x}, ${svgHeight - paddingBottom + 16})`}>{p.label}</text>
                );
              })}
              {hoveredIndex2 !== null && (
                <g>
                  <line x1={points2[hoveredIndex2].x} y1={paddingTop} x2={points2[hoveredIndex2].x} y2={svgHeight - paddingBottom} stroke="#9ca3af" strokeWidth="1" strokeDasharray="4 4" />
                  <circle cx={points2[hoveredIndex2].x} cy={points2[hoveredIndex2].y} r="5" fill="#fff" stroke="#ef4444" strokeWidth="2" />
                  <rect x={points2[hoveredIndex2].x - 35} y={points2[hoveredIndex2].y - 35} width="70" height="26" rx="4" fill="#111827" opacity="0.9" />
                  <text x={points2[hoveredIndex2].x} y={points2[hoveredIndex2].y - 18} fill="#fff" fontSize="12px" fontWeight="600" textAnchor="middle">{points2[hoveredIndex2].pctAtraso.toFixed(1)}%</text>
                </g>
              )}
              {points2.map((p, i) => {
                const segmentWidth = chartData.length > 1 ? chartWidth / (chartData.length - 1) : chartWidth;
                return (
                  <rect key={`interact2-${i}`} x={p.x - segmentWidth / 2} y={paddingTop} width={segmentWidth} height={chartHeight} fill="transparent"
                    onMouseEnter={() => setHoveredIndex2(i)} onMouseLeave={() => setHoveredIndex2(null)}
                    onClick={() => {
                      setChartFilter(prev => prev?.type === 'vcto' && prev.month === p.ym ? null : { type: 'vcto', month: p.ym });
                      setBorderoFilter(null); setDctoFilter(null);
                    }}
                    style={{ cursor: "pointer" }}
                  />
                );
              })}
            </svg>
          </div>
        </div>
      </div>
      {chartFilter && (
        <div style={{ marginTop: "12px", fontSize: "13px", color: "#2563eb", fontWeight: "500", textAlign: "right" }}>
          Filtro ativo: {chartFilter.type === 'emis' ? 'Emissão' : 'Vencimento'} em {formatarMesAno(chartFilter.month)}. Clique no gráfico novamente para limpar.
        </div>
      )}
    </div>
  );
}

// --- COMPONENTE DE INSIGHTS (Cards e Pizza) ---
function DashboardInsights({ processedRows, insightFilter, setInsightFilter, setBorderoFilter, setDctoFilter }) {
  const [hoveredSlice, setHoveredSlice] = useState(null);
  const [tooltip, setTooltip] = useState({ show: false, x: 0, y: 0, label: '', count: 0, value: 0 });

  const stats = useMemo(() => {
    const counts = { liquidado: 0, liquidadoAtraso: 0, atraso: 0, aVencer: 0, recompra: 0, total: 0 };
    const values = { liquidado: 0, liquidadoAtraso: 0, atraso: 0, aVencer: 0, recompra: 0, total: 0 };
    
    processedRows.forEach(r => {
      if (r._status !== 'invalido') {
        counts[r._status]++; counts.total++;
        const entradaKey = Object.keys(r).find(k => k.toLowerCase() === 'entrada' || k.toLowerCase().includes('valor'));
        const val = entradaKey ? (Number(r[entradaKey]) || 0) : 0;
        values[r._status] += val; values.total += val;
      }
    });
    return { counts, values };
  }, [processedRows]);

  if (stats.counts.total === 0) return null;

  const toggleFilter = (key) => {
    if (stats.counts[key] === 0) return;
    setInsightFilter(prev => prev === key ? null : key);
    setBorderoFilter(null); setDctoFilter(null);
  };

  const slicesData = [
    { key: 'liquidado', percent: stats.counts.liquidado / stats.counts.total, color: '#22c55e', label: "Liquidado em dia", count: stats.counts.liquidado, value: stats.values.liquidado },
    { key: 'liquidadoAtraso', percent: stats.counts.liquidadoAtraso / stats.counts.total, color: '#f59e0b', label: "Liquidado c/ atraso", count: stats.counts.liquidadoAtraso, value: stats.values.liquidadoAtraso },
    { key: 'atraso', percent: stats.counts.atraso / stats.counts.total, color: '#ef4444', label: "Em atraso", count: stats.counts.atraso, value: stats.values.atraso },
    { key: 'recompra', percent: stats.counts.recompra / stats.counts.total, color: '#8b5cf6', label: "Recompra", count: stats.counts.recompra, value: stats.values.recompra },
    { key: 'aVencer', percent: stats.counts.aVencer / stats.counts.total, color: '#94a3b8', label: "A Vencer", count: stats.counts.aVencer, value: stats.values.aVencer }
  ].filter(s => s.percent > 0); 

  const handleMouseMove = (e, slice) => {
    setTooltip({ show: true, x: e.clientX, y: e.clientY, label: slice.label, count: slice.count, value: slice.value });
    setHoveredSlice(slice.key);
  };

  let cumulativePercent = 0;

  const renderCard = (key, corPura, titulo, contagem, valorReal) => {
    const isZero = contagem === 0;
    const isActive = insightFilter === key;
    const isDimmed = insightFilter && !isActive;

    return (
      <div onClick={() => !isZero && toggleFilter(key)}
        style={{ background: isActive ? "#eff6ff" : "#f9fafb", padding: "18px 16px", borderRadius: "10px", border: isActive ? `2px solid ${corPura}` : "1px solid #e5e7eb", opacity: isDimmed ? 0.4 : 1, cursor: isZero ? "default" : "pointer", transition: "all 0.2s", boxShadow: isActive ? "0 4px 6px -1px rgba(0,0,0,0.1)" : "none", display: "flex", flexDirection: "column" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
          <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: corPura }} />
          <span style={{ fontSize: "13px", color: isActive ? "#1e40af" : "#4b5563", fontWeight: isActive ? "700" : "600" }}>{titulo}</span>
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
            <div style={{ fontSize: "22px", fontWeight: "700", color: "#111827", lineHeight: "1" }}>{contagem}</div>
            <div style={{ fontSize: "12px", color: "#6b7280", fontWeight: "600" }}>({stats.counts.total > 0 ? ((contagem / stats.counts.total) * 100).toFixed(1) : 0}%)</div>
          </div>
          <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "4px" }}>Qtd. de Títulos</div>
        </div>
        <hr style={{ border: 0, borderTop: "1px dashed #d1d5db", margin: "14px 0", width: "100%" }} />
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
            <div style={{ fontSize: "16px", fontWeight: "700", color: "#111827", lineHeight: "1" }}>{formatarMoeda(valorReal)}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "4px" }}>
            <div style={{ fontSize: "12px", color: "#6b7280", fontWeight: "600" }}>{stats.values.total > 0 ? ((valorReal / stats.values.total) * 100).toFixed(1) : 0}%</div>
            <div style={{ fontSize: "11px", color: "#9ca3af" }}>do Capital Total</div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ background: "#fff", padding: "24px", borderRadius: "12px", boxShadow: "0 1px 3px 0 rgba(0,0,0,0.1)", marginBottom: "24px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "32px", alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "170px", height: "170px", position: "relative" }}>
            <svg viewBox="-1.1 -1.1 2.2 2.2" style={{ transform: 'rotate(-90deg)', overflow: 'visible', width: '100%', height: '100%', filter: 'drop-shadow(0px 4px 6px rgba(0,0,0,0.15))' }} onMouseLeave={() => {setTooltip({show: false}); setHoveredSlice(null);}}>
              {slicesData.map(slice => {
                const isDimmed = insightFilter && insightFilter !== slice.key;
                if (slice.percent === 1) return <circle key={slice.key} cx="0" cy="0" r="1" fill={slice.color} onClick={() => toggleFilter(slice.key)} onMouseMove={(e) => handleMouseMove(e, slice)} style={{ transform: hoveredSlice === slice.key ? 'scale(1.05)' : 'scale(1)', transformOrigin: '0 0', opacity: isDimmed ? 0.25 : 1, transition: 'all 0.2s', cursor: 'pointer' }} />;
                
                const startX = Math.cos(2 * Math.PI * cumulativePercent);
                const startY = Math.sin(2 * Math.PI * cumulativePercent);
                cumulativePercent += slice.percent;
                const endX = Math.cos(2 * Math.PI * cumulativePercent);
                const endY = Math.sin(2 * Math.PI * cumulativePercent);
                const pathData = `M 0 0 L ${startX} ${startY} A 1 1 0 ${slice.percent > 0.5 ? 1 : 0} 1 ${endX} ${endY} Z`;

                return <path key={slice.key} d={pathData} fill={slice.color} onClick={() => toggleFilter(slice.key)} onMouseMove={(e) => handleMouseMove(e, slice)} style={{ transform: hoveredSlice === slice.key ? 'scale(1.05)' : 'scale(1)', transformOrigin: '0 0', opacity: isDimmed ? 0.25 : 1, transition: 'all 0.2s', cursor: 'pointer' }} />;
              })}
            </svg>
          </div>
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: "2px" }}>
            <span style={{ fontSize: "13px", fontWeight: "500", color: "#6b7280" }}>{stats.counts.total} títulos no total</span>
            <span style={{ fontSize: "16px", fontWeight: "700", color: "#111827" }}>{formatarMoeda(stats.values.total)}</span>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px", flex: 1 }}>
          {renderCard('liquidado', "#22c55e", "Liquidado em dia", stats.counts.liquidado, stats.values.liquidado)}
          {renderCard('liquidadoAtraso', "#f59e0b", "Liquidado c/ atraso", stats.counts.liquidadoAtraso, stats.values.liquidadoAtraso)}
          {renderCard('atraso', "#ef4444", "Em atraso", stats.counts.atraso, stats.values.atraso)}
          {renderCard('recompra', "#8b5cf6", "Recompra", stats.counts.recompra, stats.values.recompra)}
          {renderCard('aVencer', "#94a3b8", "A Vencer", stats.counts.aVencer, stats.values.aVencer)}
        </div>
      </div>
      {insightFilter && <div style={{ marginTop: "16px", fontSize: "13px", color: "#2563eb", fontWeight: "500", textAlign: "right" }}>Filtro de status ativo. Clique no card ou no gráfico novamente para limpar.</div>}
      {tooltip.show && (
        <div style={{ position: 'fixed', top: tooltip.y + 15, left: tooltip.x + 15, background: 'rgba(17, 24, 39, 0.9)', color: '#fff', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', pointerEvents: 'none', zIndex: 9999 }}>
          <div style={{ fontWeight: 600 }}>{tooltip.label}</div>
          <div style={{ marginTop: '4px', fontSize: '15px', fontWeight: 700 }}>{tooltip.count} títulos</div>
          <div style={{ marginTop: '2px', fontSize: '13px', color: '#10b981' }}>{formatarMoeda(tooltip.value)}</div>
        </div>
      )}
    </div>
  );
}

// --- COMPONENTE DA TABELA ---
function SimpleTable({ rows, clienteSelecionado, sacadoSelecionado, chartFilter, borderoFilter, setBorderoFilter, dctoFilter, setDctoFilter, setChartFilter, setInsightFilter, setClienteSelecionado, setSacadoSelecionado }) {
  const [sortConfig, setSortConfig] = useState(null);

  useEffect(() => { setSortConfig(null); }, [chartFilter]);

  const colunasOcultas = ["id", "created_at", "Cód.Red", "UF", "Banco", "Rec.", "Estado", "_status"];
  const columns = useMemo(() => {
    const set = new Set();
    for (const r of rows) Object.keys(r).forEach((k) => set.add(k));
    let cols = Array.from(set).filter(c => !colunasOcultas.includes(c));
    if (clienteSelecionado) cols = cols.filter(c => c !== "Cliente");
    if (sacadoSelecionado) cols = cols.filter(c => c !== "Sacado");
    if (clienteSelecionado && !sacadoSelecionado && cols.includes("Sacado")) cols = ["Sacado", ...cols.filter(c => c !== "Sacado")];
    else if (sacadoSelecionado && !clienteSelecionado && cols.includes("Cliente")) cols = ["Cliente", ...cols.filter(c => c !== "Cliente")];
    return cols;
  }, [rows, clienteSelecionado, sacadoSelecionado]);

  const activeSort = useMemo(() => {
    if (sortConfig) return sortConfig;
    if (rows.length === 0) return null;
    if (chartFilter?.type === 'emis') {
      const emisKey = Object.keys(rows[0]).find(k => k.toLowerCase().includes('emis'));
      if (emisKey) return { key: emisKey, direction: 'asc' };
    }
    if (chartFilter?.type === 'vcto') {
      const vctoKey = Object.keys(rows[0]).find(k => k.toLowerCase().includes('vcto') && !k.toLowerCase().includes('vl'));
      if (vctoKey) return { key: vctoKey, direction: 'asc' };
    }
    const defaultDateKey = Object.keys(rows[0]).find(k => k.toLowerCase().includes('vcto') && !k.toLowerCase().includes('vl')) || Object.keys(rows[0]).find(k => k.toLowerCase().includes('pgto') && !k.toLowerCase().includes('vl'));
    if (defaultDateKey) return { key: defaultDateKey, direction: 'desc' };
    return null;
  }, [sortConfig, rows, chartFilter]);

  const sortedRows = useMemo(() => {
    let sortableItems = [...rows];
    if (activeSort !== null) {
      sortableItems.sort((a, b) => {
        let aValue = a[activeSort.key] || ""; let bValue = b[activeSort.key] || "";
        const keyLower = activeSort.key.toLowerCase();
        const isCurrency = keyLower === "entrada" || keyLower === "vl pgto" || keyLower.includes("valor");
        const isDateColumn = !isCurrency && (keyLower.includes("emis") || keyLower.includes("vcto") || keyLower.includes("pgto") || keyLower.includes("data"));

        if (isDateColumn) {
          const dateA = new Date(aValue).getTime() || 0; const dateB = new Date(bValue).getTime() || 0;
          return activeSort.direction === 'asc' ? dateA - dateB : dateB - dateA;
        } else if (isCurrency) {
          return activeSort.direction === 'asc' ? Number(aValue) - Number(bValue) : Number(bValue) - Number(aValue);
        } else {
          const strA = String(aValue).toLowerCase(); const strB = String(bValue).toLowerCase();
          if (strA < strB) return activeSort.direction === 'asc' ? -1 : 1;
          if (strA > strB) return activeSort.direction === 'asc' ? 1 : -1;
          return 0;
        }
      });
    }
    return sortableItems;
  }, [rows, activeSort]);

  const totalFace = useMemo(() => sortedRows.reduce((acc, row) => acc + (Number(row["Entrada"]) || 0), 0), [sortedRows]);
  const requestSort = (key) => setSortConfig({ key, direction: activeSort?.key === key && activeSort.direction === 'asc' ? 'desc' : 'asc' });

  function getRowColors(status) {
    switch(status) {
      case 'liquidado': return { bg: 'rgba(34, 197, 94, 0.08)', hover: 'rgba(34, 197, 94, 0.15)' };
      case 'liquidadoAtraso': return { bg: 'rgba(245, 158, 11, 0.08)', hover: 'rgba(245, 158, 11, 0.15)' };
      case 'atraso': return { bg: 'rgba(239, 68, 68, 0.08)', hover: 'rgba(239, 68, 68, 0.15)' };
      case 'recompra': return { bg: 'rgba(139, 92, 246, 0.08)', hover: 'rgba(139, 92, 246, 0.15)' };
      case 'aVencer': return { bg: 'rgba(148, 163, 184, 0.05)', hover: 'rgba(148, 163, 184, 0.12)' };
      default: return { bg: '#fff', hover: '#f9fafb' };
    }
  }

  if (!rows.length) return null;

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", background: "#fff", display: "flex", flexDirection: "column" }}>
      <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "500px", borderRadius: "8px 8px 0 0" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "14px", whiteSpace: "nowrap" }}>
          <thead>
            <tr>
              {columns.map((c) => {
                let labelColuna = c === "Entrada" ? "Valor de Face" : c === "Cliente" ? "Cedente" : c.toLowerCase() === "vcto" ? "Dt.Vcto" : c.toLowerCase() === "pgto" ? "Dt.Pgto" : c.toLowerCase() === "vl pgto" ? "Valor Pgto" : c;
                const isSorted = activeSort?.key === c;
                return (
                  <th key={c} onClick={() => requestSort(c)} style={{ borderBottom: "2px solid #e5e7eb", padding: "12px 16px", background: isSorted ? "#eff6ff" : "#f9fafb", color: isSorted ? "#1d4ed8" : "#374151", fontWeight: "600", textAlign: "left", position: "sticky", top: 0, zIndex: 10, cursor: "pointer", userSelect: "none" }}>
                    {labelColuna}{isSorted ? (activeSort.direction === 'asc' ? ' ↑' : ' ↓') : ''}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r, idx) => {
              const { bg, hover } = getRowColors(r._status);
              return (
                <tr key={r.id ?? idx} style={{ background: bg, borderBottom: "1px solid #e5e7eb", transition: "background 0.2s" }} onMouseOver={(e) => e.currentTarget.style.background = hover} onMouseOut={(e) => e.currentTarget.style.background = bg}>
                  {columns.map((c) => {
                    let valor = r[c];
                    const cLower = c.toLowerCase();
                    const isCurrency = cLower === "entrada" || cLower === "vl pgto" || cLower.includes("valor");
                    const isDateColumn = !isCurrency && (cLower.includes("emis") || cLower.includes("vcto") || cLower.includes("pgto") || cLower.includes("data"));
                    const isBorderoCol = cLower.normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes("border");
                    const isThisBorderoFiltered = borderoFilter?.key === c && borderoFilter?.value === valor;
                    const isDctoCol = cLower === "dcto" || cLower === "documento";
                    const baseValor = String(valor || "").split(/[-/]/)[0].trim();
                    const baseFiltered = dctoFilter ? String(dctoFilter.value).split(/[-/]/)[0].trim() : null;
                    const isThisDctoFiltered = dctoFilter?.key === c && baseValor === baseFiltered;

                    if (isDateColumn) valor = formatarData(valor);
                    else if (isCurrency) valor = formatarMoeda(valor);

                    return (
                      <td key={c} style={{ padding: "12px 16px", color: "#374151" }}>
                        {isBorderoCol ? (
                          <span onClick={(e) => { e.stopPropagation(); if (isThisBorderoFiltered) setBorderoFilter(null); else { setBorderoFilter({ key: c, value: valor }); setDctoFilter(null); if (setChartFilter) setChartFilter(null); if (setInsightFilter) setInsightFilter(null); } }} style={{ background: isThisBorderoFiltered ? "#4f46e5" : "rgba(79, 70, 229, 0.08)", color: isThisBorderoFiltered ? "#fff" : "#4f46e5", padding: "4px 8px", borderRadius: "6px", fontWeight: "600", cursor: "pointer" }}>{escapeText(valor)}</span>
                        ) : isDctoCol ? (
                          <span onClick={(e) => { e.stopPropagation(); if (isThisDctoFiltered) setDctoFilter(null); else { setDctoFilter({ key: c, value: valor }); setBorderoFilter(null); if (setChartFilter) setChartFilter(null); if (setInsightFilter) setInsightFilter(null); } }} style={{ background: isThisDctoFiltered ? "#0ea5e9" : "rgba(14, 165, 233, 0.08)", color: isThisDctoFiltered ? "#fff" : "#0ea5e9", padding: "4px 8px", borderRadius: "6px", fontWeight: "600", cursor: "pointer" }}>{escapeText(valor)}</span>
                        ) : c === "Cliente" ? (
                          <span onClick={(e) => { e.stopPropagation(); setClienteSelecionado(valor); }} style={{ cursor: "pointer", fontWeight: "600", color: "#374151" }} onMouseOver={(e) => e.currentTarget.style.color = '#4f46e5'} onMouseOut={(e) => e.currentTarget.style.color = '#374151'}>{escapeText(valor)}</span>
                        ) : c === "Sacado" ? (
                          <span onClick={(e) => { e.stopPropagation(); setSacadoSelecionado(valor); }} style={{ cursor: "pointer", fontWeight: "600", color: "#374151" }} onMouseOver={(e) => e.currentTarget.style.color = '#4f46e5'} onMouseOut={(e) => e.currentTarget.style.color = '#374151'}>{escapeText(valor)}</span>
                        ) : ( escapeText(valor) )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ padding: "16px 24px", background: "#f9fafb", borderTop: "1px solid #e5e7eb", textAlign: "right", borderRadius: "0 0 8px 8px" }}>
        <span style={{ color: "#4b5563", fontWeight: "500", marginRight: "12px", fontSize: "14px" }}>Total de Valor de Face visível na tabela:</span>
        <span style={{ color: "#111827", fontWeight: "700", fontSize: "18px" }}>{formatarMoeda(totalFace)}</span>
      </div>
    </div>
  );
}

// --- DROPDOWN CUSTOMIZADO ---
function CustomDropdown({ value, options, onChange, placeholder }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const wrapperRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) { if (wrapperRef.current && !wrapperRef.current.contains(event.target)) { setIsOpen(false); setSearchTerm(""); } }
    document.addEventListener("mousedown", handleClickOutside); return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredOptions = options.filter(opt => opt.toLowerCase().includes(searchTerm.toLowerCase()));
  const handleKeyDown = (e) => { if (e.key === 'Enter') { e.preventDefault(); if (isOpen && filteredOptions.length > 0) { onChange(filteredOptions[0]); setSearchTerm(""); setIsOpen(false); } } };
  const displayValue = isOpen ? searchTerm : value;

  return (
    <div ref={wrapperRef} style={{ position: "relative", width: "100%" }}>
      <input type="text" value={displayValue} onChange={(e) => { setSearchTerm(e.target.value); setIsOpen(true); }} onFocus={() => { setIsOpen(true); setSearchTerm(""); }} onKeyDown={handleKeyDown} placeholder={isOpen && value ? value : placeholder} style={{ width: "100%", padding: "12px", borderRadius: "8px", border: "1px solid #d1d5db", background: "#f9fafb", fontSize: "14px", color: "#111827", outline: "none", boxSizing: "border-box" }} />
      <div style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#6b7280", fontSize: "12px" }}>▼</div>
      {isOpen && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: "4px", background: "#fff", border: "1px solid #d1d5db", borderRadius: "8px", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)", zIndex: 50, maxHeight: "250px", overflowY: "auto" }}>
          {value && <div onClick={() => { onChange(""); setSearchTerm(""); setIsOpen(false); }} style={{ padding: "10px 12px", cursor: "pointer", borderBottom: "1px solid #e5e7eb", fontSize: "14px", color: "#dc2626", fontStyle: "italic" }}>-- Limpar Seleção --</div>}
          {filteredOptions.length > 0 ? filteredOptions.map(opt => <div key={opt} onClick={() => { onChange(opt); setSearchTerm(""); setIsOpen(false); }} style={{ padding: "10px 12px", cursor: "pointer", borderBottom: "1px solid #f3f4f6", fontSize: "14px", color: "#374151" }} onMouseOver={(e) => e.currentTarget.style.background = "#eff6ff"} onMouseOut={(e) => e.currentTarget.style.background = "#fff"}>{opt}</div>) : <div style={{ padding: "10px 12px", fontSize: "14px", color: "#6b7280" }}>Nenhum encontrado</div>}
        </div>
      )}
    </div>
  );
}

// --- EXPORTAÇÃO DO MICRODASHBOARD ---
export default function MicroDashboard({ session }) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  
  const [viewMode, setViewMode] = useState('all'); 
  const [insightFilter, setInsightFilter] = useState(null);
  const [chartFilter, setChartFilter] = useState(null);
  const [borderoFilter, setBorderoFilter] = useState(null); 
  const [dctoFilter, setDctoFilter] = useState(null); 
  
  const [relacionamentos, setRelacionamentos] = useState([]);
  const [clienteSelecionado, setClienteSelecionado] = useState("");
  const [sacadoSelecionado, setSacadoSelecionado] = useState("");

  useEffect(() => {
    setInsightFilter(null); setChartFilter(null); setBorderoFilter(null); setDctoFilter(null);
  }, [clienteSelecionado, sacadoSelecionado]);

  const processedRows = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return rows.map(r => {
      let status = 'invalido';
      const vctoKey = Object.keys(r).find(k => k.toLowerCase() === 'vcto' || (k.toLowerCase().includes('vcto') && !k.toLowerCase().includes('vl')));
      const pgtoKey = Object.keys(r).find(k => k.toLowerCase() === 'pgto' || (k.toLowerCase().includes('pgto') && !k.toLowerCase().includes('vl')));
      const statusKey = Object.keys(r).find(k => k.toLowerCase() === 'status' || k.toLowerCase() === 'estado');

      const vctoVal = vctoKey ? r[vctoKey] : null; const pgtoVal = pgtoKey ? r[pgtoKey] : null;
      const statusVal = statusKey ? String(r[statusKey]).trim().toUpperCase() : "";

      if (statusVal === "REC" || statusVal.includes("REC")) status = 'recompra';
      else if (vctoVal) {
        const effectiveVcto = new Date(String(vctoVal).split("T")[0] + "T00:00:00");
        if (effectiveVcto.getDay() === 6) effectiveVcto.setDate(effectiveVcto.getDate() + 2);
        else if (effectiveVcto.getDay() === 0) effectiveVcto.setDate(effectiveVcto.getDate() + 1);

        if (pgtoVal && String(pgtoVal).trim() !== "") {
          const pgtoDate = new Date(String(pgtoVal).split("T")[0] + "T00:00:00");
          if (pgtoDate <= effectiveVcto) status = 'liquidado'; else status = 'liquidadoAtraso';
        } else {
          if (effectiveVcto < today) status = 'atraso'; else status = 'aVencer';
        }
      }
      return { ...r, _status: status }; 
    });
  }, [rows]);

  const rowsFilteredByMode = useMemo(() => {
    if (viewMode === 'finalized') return processedRows.filter(r => !['aVencer', 'atraso'].includes(r._status));
    if (viewMode === 'open') return processedRows.filter(r => ['aVencer', 'atraso'].includes(r._status));
    return processedRows;
  }, [processedRows, viewMode]);

  const evolutionRows = useMemo(() => {
    if (!insightFilter) return rowsFilteredByMode;
    return rowsFilteredByMode.filter(r => r._status === insightFilter);
  }, [rowsFilteredByMode, insightFilter]);

  const rowsFilteredByChart = useMemo(() => {
    if (!chartFilter) return rowsFilteredByMode;
    return rowsFilteredByMode.filter(r => {
      if (chartFilter.type === 'emis') {
        const emisKey = Object.keys(r).find(k => k.toLowerCase().includes('emis'));
        return emisKey && r[emisKey] && String(r[emisKey]).startsWith(chartFilter.month);
      } else if (chartFilter.type === 'vcto') {
        const vctoKey = Object.keys(r).find(k => k.toLowerCase() === 'vcto' || (k.toLowerCase().includes('vcto') && !k.toLowerCase().includes('vl')));
        return vctoKey && r[vctoKey] && String(r[vctoKey]).startsWith(chartFilter.month);
      }
      return true;
    });
  }, [rowsFilteredByMode, chartFilter]);

  const rowsParaTabela = useMemo(() => {
    let filtered = rowsFilteredByChart;
    if (insightFilter) filtered = filtered.filter(r => r._status === insightFilter);
    if (borderoFilter) filtered = filtered.filter(r => r[borderoFilter.key] === borderoFilter.value);
    if (dctoFilter) {
      const baseTarget = String(dctoFilter.value).split(/[-/]/)[0].trim();
      filtered = filtered.filter(r => String(r[dctoFilter.key] || "").split(/[-/]/)[0].trim() === baseTarget);
    }
    return filtered;
  }, [rowsFilteredByChart, insightFilter, borderoFilter, dctoFilter]);

  useEffect(() => {
    if (session) {
      async function buscarRelacionamentos() {
        const { data, error } = await supabase.from("secInfo").select("Cliente, Sacado");
        if (data) setRelacionamentos(data.filter(r => sacadoValido(r.Sacado) && cedenteValido(r.Cliente)));
      }
      buscarRelacionamentos();
    }
  }, [session]);

  const clientesDisponiveis = useMemo(() => {
    let base = relacionamentos;
    if (sacadoSelecionado) base = base.filter(r => r.Sacado === sacadoSelecionado);
    return Array.from(new Set(base.map(r => r.Cliente).filter(Boolean))).sort();
  }, [relacionamentos, sacadoSelecionado]);

  const sacadosDisponiveis = useMemo(() => {
    let base = relacionamentos;
    if (clienteSelecionado) base = base.filter(r => r.Cliente === clienteSelecionado);
    return Array.from(new Set(base.map(r => r.Sacado).filter(Boolean))).sort();
  }, [relacionamentos, clienteSelecionado]);

  useEffect(() => {
    if (!session?.user?.id) return;
    const delayDebounceFn = setTimeout(async () => {
      setLoading(true);
      let query = supabase.from("secInfo").select("*");
      if (clienteSelecionado) query = query.eq("Cliente", clienteSelecionado);
      if (sacadoSelecionado) query = query.eq("Sacado", sacadoSelecionado);
      query = query.order("id", { ascending: false }).limit(10000);
      const { data } = await query;
      if (data) setRows(data.filter(r => sacadoValido(r.Sacado) && cedenteValido(r.Cliente)));
      setLoading(false);
    }, 300);
    return () => clearTimeout(delayDebounceFn);
  }, [clienteSelecionado, sacadoSelecionado, session?.user?.id]);

  const limparFiltros = () => {
    setClienteSelecionado(""); setSacadoSelecionado(""); setViewMode('all');
    setInsightFilter(null); setChartFilter(null); setBorderoFilter(null); setDctoFilter(null);
  };

  const hasAnyFilter = clienteSelecionado || sacadoSelecionado || viewMode !== 'all' || insightFilter || chartFilter || borderoFilter || dctoFilter;

  const getTabStyle = (isActive) => ({
    padding: "8px 16px", borderRadius: "6px", border: "1px solid", borderColor: isActive ? "#4f46e5" : "#d1d5db",
    background: isActive ? "#e0e7ff" : "#fff", color: isActive ? "#4f46e5" : "#4b5563",
    fontWeight: "600", fontSize: "13px", cursor: "pointer", transition: "all 0.2s"
  });

  return (
    <div style={{ background: "#fff", padding: "24px", borderRadius: "12px", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)" }}>
      <h2 style={{ margin: "0 0 20px 0", color: "#111827", fontSize: "18px" }}>Filtro de Registos</h2>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "20px", marginBottom: "8px", alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 280px" }}>
          <label style={{ display: "block", marginBottom: 8, fontSize: "14px", fontWeight: "500", color: "#374151" }}>Cedente</label>
          <CustomDropdown value={clienteSelecionado} onChange={setClienteSelecionado} options={clientesDisponiveis} placeholder="Selecione ou digite o Cedente..." />
        </div>
        <div style={{ flex: "1 1 280px" }}>
          <label style={{ display: "block", marginBottom: 8, fontSize: "14px", fontWeight: "500", color: "#374151" }}>Sacado</label>
          <CustomDropdown value={sacadoSelecionado} onChange={setSacadoSelecionado} options={sacadosDisponiveis} placeholder="Selecione ou digite o Sacado..." />
        </div>
        <div>
          <button onClick={limparFiltros} disabled={!hasAnyFilter} style={{ padding: "12px 20px", borderRadius: "8px", border: "1px solid #d1d5db", background: (!hasAnyFilter) ? "#f3f4f6" : "#fff", color: (!hasAnyFilter) ? "#9ca3af" : "#374151", fontWeight: "500", fontSize: "14px", cursor: (!hasAnyFilter) ? "not-allowed" : "pointer", transition: "all 0.2s" }}>Limpar Tudo</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: "10px", marginTop: "16px", flexWrap: "wrap" }}>
        <button onClick={() => { setViewMode('all'); setInsightFilter(null); setChartFilter(null); setBorderoFilter(null); setDctoFilter(null); }} style={getTabStyle(viewMode === 'all')}>Visão Geral</button>
        <button onClick={() => { setViewMode(prev => prev === 'finalized' ? 'all' : 'finalized'); setInsightFilter(null); setChartFilter(null); setBorderoFilter(null); setDctoFilter(null); }} style={getTabStyle(viewMode === 'finalized')}>Operações Já Finalizadas</button>
        <button onClick={() => { setViewMode(prev => prev === 'open' ? 'all' : 'open'); setInsightFilter(null); setChartFilter(null); setBorderoFilter(null); setDctoFilter(null); }} style={getTabStyle(viewMode === 'open')}>Mostrar Em Aberto</button>
      </div>

      {rowsFilteredByMode.length > 0 && (
        <div style={{ marginTop: "24px" }}>
          <DashboardInsights 
            processedRows={rowsFilteredByChart} insightFilter={insightFilter} setInsightFilter={setInsightFilter} 
            setBorderoFilter={setBorderoFilter} setDctoFilter={setDctoFilter}
          />
          <EvolutionCharts 
            rows={evolutionRows} chartFilter={chartFilter} setChartFilter={setChartFilter}
            setBorderoFilter={setBorderoFilter} setDctoFilter={setDctoFilter}
          />
        </div>
      )}

      <div style={{ marginTop: "16px", position: "relative", minHeight: loading ? "150px" : "auto" }}>
        {loading && (
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(255,255,255,0.7)", zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "8px" }}>
            <div style={{ padding: "10px 20px", background: "#4f46e5", color: "#fff", borderRadius: "8px", fontSize: "14px", fontWeight: "600", boxShadow: "0 4px 6px rgba(0,0,0,0.1)" }}>A carregar dados...</div>
          </div>
        )}
        
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "16px", flexWrap: "wrap" }}>
          {borderoFilter && <div style={{ marginBottom: "12px", fontSize: "13px", color: "#4f46e5", fontWeight: "600", textAlign: "right" }}>Filtro de Borderô ativo: {borderoFilter.value}. Clique no número na tabela para limpar.</div>}
          {dctoFilter && <div style={{ marginBottom: "12px", fontSize: "13px", color: "#0ea5e9", fontWeight: "600", textAlign: "right" }}>Filtro de Documento ativo (Raiz: {String(dctoFilter.value).split(/[-/]/)[0].trim()}). Clique no número na tabela para limpar.</div>}
        </div>

        {(!hasAnyFilter && !loading) ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "#6b7280", background: "#fff", borderRadius: "12px", border: "1px dashed #d1d5db", boxShadow: "0 1px 3px 0 rgba(0,0,0,0.1)" }}>
            <p style={{ margin: 0, fontSize: "15px", fontWeight: "500" }}>Tabela oculta na Visão Geral para otimizar o desempenho.</p>
            <p style={{ margin: "8px 0 0 0", fontSize: "13px" }}>Selecione um <strong>Cedente</strong>, <strong>Sacado</strong> ou clique nos cards e gráficos para carregar os registos detalhados.</p>
          </div>
        ) : (
          (!loading || rowsParaTabela.length > 0) && (
            <SimpleTable 
              rows={rowsParaTabela} clienteSelecionado={clienteSelecionado} sacadoSelecionado={sacadoSelecionado} 
              chartFilter={chartFilter} borderoFilter={borderoFilter} setBorderoFilter={setBorderoFilter}
              dctoFilter={dctoFilter} setDctoFilter={setDctoFilter} setChartFilter={setChartFilter} setInsightFilter={setInsightFilter}
              setClienteSelecionado={setClienteSelecionado} setSacadoSelecionado={setSacadoSelecionado}
            />
          )
        )}
      </div>
    </div>
  );
}