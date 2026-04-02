import React, { useEffect, useMemo, useState, useRef } from "react";
import { supabase } from "./supabaseClient";

// --- COLLAPSE ANIMADO ---
function CollapsePanel({ isCollapsed, children }) {
  const ref = useRef(null);
  const [maxHeight, setMaxHeight] = useState(isCollapsed ? "0px" : "none");
  const [overflow, setOverflow] = useState(isCollapsed ? "hidden" : "visible");
  const prevCollapsed = useRef(isCollapsed);

  useEffect(() => {
    if (prevCollapsed.current === isCollapsed) return;
    prevCollapsed.current = isCollapsed;
    const el = ref.current;
    if (!el) return;

    if (isCollapsed) {
      setOverflow("hidden");
      setMaxHeight(el.scrollHeight + "px");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { setMaxHeight("0px"); });
      });
    } else {
      setOverflow("hidden");
      setMaxHeight(el.scrollHeight + "px");
      const onEnd = () => {
        setMaxHeight("none");
        setOverflow("visible");
        el.removeEventListener("transitionend", onEnd);
      };
      el.addEventListener("transitionend", onEnd);
    }
  }, [isCollapsed]);

  return (
    <div ref={ref} style={{ maxHeight, overflow, transition: "max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1)" }}>
      {children}
    </div>
  );
}

// --- FUNÇÕES DE FORMATAÇÃO E DATAS ---
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

const formatToLocalISO = (d) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const getInitDateStr = () => {
  const end = new Date();
  const start = new Date();
  start.setFullYear(end.getFullYear() - 1);
  return { start: formatToLocalISO(start), end: formatToLocalISO(end) };
};

const CEDENTES_IGNORADOS = ["12 -", "23 -", "2 -"];

const GRUPOS_ECONOMICOS = [
  {
    label: "BDP Broadcast",
    prefixos: ["466 -", "479 -"]
  },
  {
    label: "JL & D Confecções",
    prefixos: ["613 -", "614 -", "615 -", "617 -", "605 -"]
  }
];


function getDiasUteisToleranciaComissaria(cedente) {
  if (!cedente) return 0;
  const ced = String(cedente).trim();

  if (ced.startsWith("160 -") || ced.startsWith("260 -")) {
    return 2;
  }

  if (ced.startsWith("466 -") || ced.startsWith("479 -")) {
    return 1;
  }

  return 0;
}

function adicionarDiasUteis(baseDate, qtdDiasUteis) {
  const d = new Date(baseDate);
  let adicionados = 0;

  while (adicionados < qtdDiasUteis) {
    d.setDate(d.getDate() + 1);
    const diaSemana = d.getDay();
    if (diaSemana !== 0 && diaSemana !== 6) {
      adicionados++;
    }
  }

  return d;
}


function cedenteValido(cedente) {
  if (!cedente) return false;
  return !CEDENTES_IGNORADOS.some(ignorado => String(cedente).trim().startsWith(ignorado));
}
function sacadoValido(sacado) {
  if (!sacado) return false;
  const s = String(sacado).trim();
  return !(s === "0s" || s.startsWith("0 s-") || s.startsWith("0s-"));
}

// --- COMPONENTE DE EVOLUÇÃO ---
function EvolutionCharts({ rows, dateFilter, setDateFilter, setBorderoFilter, setDctoFilter, hideValues }) {
  const fmtM = (v) => hideValues ? "R$ -" : formatarMoeda(v);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const [hoveredIndex1, setHoveredIndex1] = useState(null);
  const [hoveredIndex2, setHoveredIndex2] = useState(null);
  const [hoveredIndex3, setHoveredIndex3] = useState(null);
  const [hoveredIndex4, setHoveredIndex4] = useState(null);

  const [dragState, setDragState] = useState({ isDragging: false, startIndex: null, currentIndex: null, type: null });

  const { chartData, chartDataRate, chartDataDesagio } = useMemo(() => {
    const grouped = {};
    const groupedRate = {};
    const groupedDesagio = {};

    if (rows.length === 0) return { chartData: [], chartDataRate: [], chartDataDesagio: [] };

    const firstRow = rows[0];
    const emisKey = Object.keys(firstRow).find(k => k.toLowerCase().includes('emis'));
    const vctoKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'vcto' || (k.toLowerCase().includes('vcto') && !k.toLowerCase().includes('vl')));
    const valKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'entrada' || (k.toLowerCase().includes('valor') && !k.toLowerCase().includes('pgto')));
    const borderoKey = Object.keys(firstRow).find(k => k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes("border"));
    const rateKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'tx.efet' || k.toLowerCase().includes('tx.efet') || k.toLowerCase().includes('tx efet'));
    const desagioKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'desagio' || k.toLowerCase() === 'deságio');

    rows.forEach((r, idx) => {
      const bNum = (borderoKey && r[borderoKey]) ? String(r[borderoKey]).trim() : `avulso_${idx}`; 
      const val = valKey ? (Number(r[valKey]) || 0) : 0;
      const desagioVal = desagioKey ? (Number(r[desagioKey]) || 0) : 0;

      if (emisKey && r[emisKey]) {
        const emisStr = String(r[emisKey]).split("T")[0];
        if (emisStr.length >= 7) {
          const ym = emisStr.substring(0, 7); 
          if (!grouped[ym]) grouped[ym] = { val: 0, numAtraso: 0, numTotalFin: 0 };
          grouped[ym].val += val;

          if (!groupedRate[ym]) groupedRate[ym] = new Map();
          const rawRate = rateKey ? r[rateKey] : null;
          const hasRateVal = rawRate !== null && rawRate !== undefined && String(rawRate).trim() !== "";
          const rate = hasRateVal ? (Number(String(rawRate).replace('%', '').replace(',', '.')) || 0) : 0;

          const mapYm = groupedRate[ym];
          if (!mapYm.has(bNum)) {
             mapYm.set(bNum, { totalValue: 0, rate: 0, hasRate: false });
          }
          const bData = mapYm.get(bNum);
          bData.totalValue += val;
          if (!bData.hasRate && hasRateVal) {
             bData.rate = rate;
             bData.hasRate = true;
          }

          if (!groupedDesagio[ym]) groupedDesagio[ym] = new Map();
          if (!groupedDesagio[ym].has(bNum)) {
            groupedDesagio[ym].set(bNum, desagioVal);
          }
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

    const cData = sortedMonths.map(ym => {
      const obj = grouped[ym];
      return { ym, label: formatarMesAno(ym), value: obj.val, pctAtraso: obj.numTotalFin > 0 ? (obj.numAtraso / obj.numTotalFin) * 100 : 0 };
    });

    const cDataRate = sortedMonths.map(ym => {
      let sumVal = 0;
      let sumWeightedRate = 0;
      if (groupedRate[ym]) {
        groupedRate[ym].forEach(b => {
           if (b.hasRate && b.totalValue > 0) {
              sumVal += b.totalValue;
              sumWeightedRate += (b.rate * b.totalValue);
           }
        });
      }
      const avgRate = sumVal > 0 ? (sumWeightedRate / sumVal) : 0;
      return { ym, label: formatarMesAno(ym), avgRate };
    });

    const cDataDesagio = sortedMonths.map(ym => {
      let sumDesagio = 0;
      if (groupedDesagio[ym]) {
        groupedDesagio[ym].forEach(val => sumDesagio += val);
      }
      return { ym, label: formatarMesAno(ym), value: sumDesagio };
    });

    return { chartData: cData, chartDataRate: cDataRate, chartDataDesagio: cDataDesagio };
  }, [rows]);

  useEffect(() => {
    const handleMouseUp = () => {
       if (dragState.isDragging) {
          const minIdx = Math.min(dragState.startIndex, dragState.currentIndex);
          const maxIdx = Math.max(dragState.startIndex, dragState.currentIndex);
          
          if (chartData[minIdx] && chartData[maxIdx]) {
             const startMonth = chartData[minIdx].ym;
             const endMonth = chartData[maxIdx].ym;
             
             const [sy, sm] = startMonth.split('-');
             const startDate = `${sy}-${sm}-01`;
             
             const [ey, em] = endMonth.split('-');
             const lastDay = new Date(ey, em, 0).getDate();
             const endDate = `${ey}-${em}-${String(lastDay).padStart(2, '0')}`;
             
             if (dateFilter.start === startDate && dateFilter.end === endDate && dateFilter.type === dragState.type) {
                setDateFilter({ type: 'emis', start: '', end: '' });
             } else {
                setDateFilter({ type: dragState.type, start: startDate, end: endDate });
             }
             setBorderoFilter(null); 
             setDctoFilter(null);
          }
          setDragState({ isDragging: false, startIndex: null, currentIndex: null, type: null });
       }
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [dragState, chartData, dateFilter, setDateFilter, setBorderoFilter, setDctoFilter]);


  if (chartData.length === 0) return null;

  const svgWidth = 600; const svgHeight = 240; 
  const paddingX = 50; const paddingRight = 20; const paddingTop = 30; const paddingBottom = 55; 
  const chartWidth = svgWidth - paddingX - paddingRight; const chartHeight = svgHeight - paddingTop - paddingBottom;
  const step = Math.ceil(chartData.length / 12); 
  const segmentWidth = chartData.length > 1 ? chartWidth / (chartData.length - 1) : chartWidth;

  const formatAxisVal = (val) => {
    if (hideValues) return 'R$ -';
    if (val === 0) return '0';
    if (val >= 1000000) { const n = (val / 1000000).toFixed(1); return (n.endsWith('.0') ? n.slice(0, -2) : n) + 'M'; }
    if (val >= 1000) { const n = (val / 1000).toFixed(1); return (n.endsWith('.0') ? n.slice(0, -2) : n) + 'K'; }
    return Math.floor(val).toString();
  };
  const formatAxisPct = (val) => Math.floor(val) + '%';
  const formatAxisRate = (val) => val.toFixed(1) + '%';

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

  const maxVal3 = Math.max(...chartDataRate.map(d => d.avgRate), 1); 
  const points3 = chartDataRate.map((d, i) => {
    const x = chartDataRate.length > 1 ? paddingX + (i / (chartDataRate.length - 1)) * chartWidth : paddingX + chartWidth / 2;
    const y = svgHeight - paddingBottom - (d.avgRate / maxVal3) * chartHeight;
    return { ...d, x, y };
  });
  const pathD3 = points3.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaD3 = points3.length > 1 ? `${pathD3} L ${points3[points3.length - 1].x} ${svgHeight - paddingBottom} L ${points3[0].x} ${svgHeight - paddingBottom} Z` : "";

  const maxVal4 = Math.max(...chartDataDesagio.map(d => d.value), 10);
  const points4 = chartDataDesagio.map((d, i) => {
    const x = chartDataDesagio.length > 1 ? paddingX + (i / (chartDataDesagio.length - 1)) * chartWidth : paddingX + chartWidth / 2;
    const y = svgHeight - paddingBottom - (d.value / maxVal4) * chartHeight;
    return { ...d, x, y };
  });
  const pathD4 = points4.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaD4 = points4.length > 1 ? `${pathD4} L ${points4[points4.length - 1].x} ${svgHeight - paddingBottom} L ${points4[0].x} ${svgHeight - paddingBottom} Z` : "";

  const isPointSelected = (p, i, type) => {
    if (dragState.isDragging && dragState.type === type) {
      const minIdx = Math.min(dragState.startIndex, dragState.currentIndex);
      const maxIdx = Math.max(dragState.startIndex, dragState.currentIndex);
      return i >= minIdx && i <= maxIdx;
    }
    if (dateFilter.type === type && (dateFilter.start || dateFilter.end)) {
      const dsStr = dateFilter.start ? dateFilter.start.substring(0,7) : "0000-00";
      const deStr = dateFilter.end ? dateFilter.end.substring(0,7) : "9999-99";
      return p.ym >= dsStr && p.ym <= deStr;
    }
    return false;
  };

  const renderHighlight = (points, type, rgb) => {
    const clampStart = (val) => Math.max(paddingX, val);
    const clampEnd = (val) => Math.min(svgWidth - paddingRight, val);

    if (dragState.isDragging && dragState.type === type && points.length > 0) {
       const minIdx = Math.min(dragState.startIndex, dragState.currentIndex);
       const maxIdx = Math.max(dragState.startIndex, dragState.currentIndex);
       if (points[minIdx] && points[maxIdx]) {
          const xStart = clampStart(points[minIdx].x - segmentWidth/2);
          const xEnd = clampEnd(points[maxIdx].x + segmentWidth/2);
          return <rect x={xStart} y={paddingTop} width={Math.max(0, xEnd - xStart)} height={chartHeight} fill={`rgba(${rgb}, 0.15)`} stroke={`rgba(${rgb}, 0.5)`} strokeWidth="1" />;
       }
    }

    if (dateFilter.type === type && (dateFilter.start || dateFilter.end)) {
       const dsStr = dateFilter.start ? dateFilter.start.substring(0,7) : "0000-00";
       const deStr = dateFilter.end ? dateFilter.end.substring(0,7) : "9999-99";
       const selPoints = points.filter(p => p.ym >= dsStr && p.ym <= deStr);
       if (selPoints.length > 0) {
          const xStart = clampStart(selPoints[0].x - segmentWidth/2);
          const xEnd = clampEnd(selPoints[selPoints.length - 1].x + segmentWidth/2);
          return <rect x={xStart} y={paddingTop} width={Math.max(0, xEnd - xStart)} height={chartHeight} fill={`rgba(${rgb}, 0.08)`} />;
       }
    }
    return null;
  }

const chartBoxStyle = { flex: "1 1 400px", minWidth: "250px", maxWidth: "100%", background: "#fff", padding: "20px", borderRadius: "10px", border: "1px solid #e5e7eb", boxShadow: "0 4px 12px rgba(0,0,0,0.05)", boxSizing: "border-box" };
return (
    <div style={{ background: "#fff", padding: "24px", borderRadius: "12px", boxShadow: "0 8px 20px rgba(0, 0, 0, 0.06)", border: "1px solid #e5e7eb" }}>
      <div onClick={() => setIsCollapsed(!isCollapsed)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none" }}>
        <div>
           <h2 style={{ margin: 0, fontSize: "16px", fontWeight: "700", color: "#374151" }}>Análise Gráfica Evolutiva</h2>
           <p style={{ margin: 0, fontSize: "12px", color: "#6b7280" }}>Arraste o mouse sobre os gráficos para selecionar um período.</p>
        </div>
        <span style={{ background: "transparent", border: "1px solid #d1d5db", padding: "4px 10px", borderRadius: "6px", color: "#4b5563", fontSize: "12px", fontWeight: "600", display: "flex", alignItems: "center", gap: "6px" }}>
          Gráficos
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{transition:"transform 0.35s cubic-bezier(0.4,0,0.2,1)",transform:isCollapsed?"rotate(0deg)":"rotate(180deg)"}}><polyline points="6 9 12 15 18 9"/></svg>
        </span>
      </div>

      <CollapsePanel isCollapsed={isCollapsed}>
        <div style={{ paddingTop: "24px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "24px", marginBottom: "24px" }}>
            <div style={chartBoxStyle}>
              <h3 style={{ margin: "0 0 16px 0", color: "#111827", fontSize: "16px", fontWeight: "600" }}>
                Evolução de Valores <span style={{fontSize: "12px", color:"#9ca3af", fontWeight: "400"}}>(Emissão)</span>
              </h3>
              <div style={{ position: "relative", width: "100%", height: "auto" }}>
                <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ width: "100%", height: "auto", overflow: "visible" }}>
                  <defs><linearGradient id="gradientArea1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4f46e5" stopOpacity="0.4" /><stop offset="100%" stopColor="#4f46e5" stopOpacity="0.0" /></linearGradient></defs>
                  {renderHighlight(points1, 'emis', '79, 70, 229')}
                  <line x1={paddingX} y1={paddingTop} x2={svgWidth - paddingRight} y2={paddingTop} stroke="#f3f4f6" strokeWidth="1" />
                  <line x1={paddingX} y1={paddingTop + chartHeight / 2} x2={svgWidth - paddingRight} y2={paddingTop + chartHeight / 2} stroke="#f3f4f6" strokeWidth="1" />
                  <line x1={paddingX} y1={svgHeight - paddingBottom} x2={svgWidth - paddingRight} y2={svgHeight - paddingBottom} stroke="#e5e7eb" strokeWidth="1" />
                  <text x={paddingX - 8} y={paddingTop + 4} fill="#9ca3af" fontSize="11px" fontWeight="500" textAnchor="end">{formatAxisVal(maxVal1)}</text>
                  <text x={paddingX - 8} y={paddingTop + chartHeight / 2 + 4} fill="#9ca3af" fontSize="11px" fontWeight="500" textAnchor="end">{formatAxisVal(maxVal1 / 2)}</text>
                  <text x={paddingX - 8} y={svgHeight - paddingBottom + 4} fill="#9ca3af" fontSize="11px" fontWeight="500" textAnchor="end">0</text>
                  {points1.length > 1 && <path d={areaD1} fill="url(#gradientArea1)" />}
                  <path d={pathD1} fill="none" stroke="#4f46e5" strokeWidth="3" strokeLinejoin="round" />
                  
                  {points1.map((p, i) => {
                    const isSelected = isPointSelected(p, i, 'emis');
                    return isSelected ? <circle key={`sel1-${i}`} cx={p.x} cy={p.y} r="5" fill="#4f46e5" stroke="#fff" strokeWidth="2" /> : null;
                  })}
                  {points1.map((p, i) => {
                    if (i % step !== 0 && i !== points1.length - 1) return null;
                    const isSelected = isPointSelected(p, i, 'emis');
                    return <text key={`lab1-${i}`} x={p.x} y={svgHeight - paddingBottom + 16} fill={isSelected ? "#4f46e5" : "#6b7280"} fontSize="11px" fontWeight={isSelected ? "700" : "400"} textAnchor="end" transform={`rotate(-45, ${p.x}, ${svgHeight - paddingBottom + 16})`}>{p.label}</text>;
                  })}
                  {hoveredIndex1 !== null && (
                    <g>
                      <line x1={points1[hoveredIndex1].x} y1={paddingTop} x2={points1[hoveredIndex1].x} y2={svgHeight - paddingBottom} stroke="#9ca3af" strokeWidth="1" strokeDasharray="4 4" />
                      <circle cx={points1[hoveredIndex1].x} cy={points1[hoveredIndex1].y} r="5" fill="#fff" stroke="#4f46e5" strokeWidth="2" />
                      <rect x={points1[hoveredIndex1].x - 60} y={points1[hoveredIndex1].y - 35} width="120" height="26" rx="4" fill="#111827" opacity="0.9" />
                      <text x={points1[hoveredIndex1].x} y={points1[hoveredIndex1].y - 18} fill="#fff" fontSize="11px" fontWeight="600" textAnchor="middle">{fmtM(points1[hoveredIndex1].value)}</text>
                    </g>
                  )}
                  {points1.map((p, i) => (
                    <rect key={`interact1-${i}`} x={p.x - segmentWidth / 2} y={paddingTop} width={segmentWidth} height={chartHeight} fill="transparent"
                      onMouseDown={(e) => { e.preventDefault(); setDragState({ isDragging: true, startIndex: i, currentIndex: i, type: 'emis' }); }}
                      onMouseEnter={() => { setHoveredIndex1(i); if (dragState.isDragging && dragState.type === 'emis') setDragState(prev => ({...prev, currentIndex: i})); }}
                      onMouseLeave={() => setHoveredIndex1(null)}
                      style={{ cursor: "crosshair" }}
                    />
                  ))}
                </svg>
              </div>
            </div>

            <div style={chartBoxStyle}>
              <h3 style={{ margin: "0 0 16px 0", color: "#111827", fontSize: "16px", fontWeight: "600" }}>
                Percentual de Atraso <span style={{fontSize: "12px", color:"#9ca3af", fontWeight: "400"}}>(Vencimento)</span>
              </h3>
              <div style={{ position: "relative", width: "100%", height: "auto" }}>
                <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ width: "100%", height: "auto", overflow: "visible" }}>
                  <defs><linearGradient id="gradientArea2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ef4444" stopOpacity="0.3" /><stop offset="100%" stopColor="#ef4444" stopOpacity="0.0" /></linearGradient></defs>
                  {renderHighlight(points2, 'vcto', '239, 68, 68')}
                  <line x1={paddingX} y1={paddingTop} x2={svgWidth - paddingRight} y2={paddingTop} stroke="#f3f4f6" strokeWidth="1" />
                  <line x1={paddingX} y1={paddingTop + chartHeight / 2} x2={svgWidth - paddingRight} y2={paddingTop + chartHeight / 2} stroke="#f3f4f6" strokeWidth="1" />
                  <line x1={paddingX} y1={svgHeight - paddingBottom} x2={svgWidth - paddingRight} y2={svgHeight - paddingBottom} stroke="#e5e7eb" strokeWidth="1" />
                  <text x={paddingX - 8} y={paddingTop + 4} fill="#9ca3af" fontSize="11px" fontWeight="500" textAnchor="end">{formatAxisPct(maxVal2)}</text>
                  <text x={paddingX - 8} y={paddingTop + chartHeight / 2 + 4} fill="#9ca3af" fontSize="11px" fontWeight="500" textAnchor="end">{formatAxisPct(maxVal2 / 2)}</text>
                  <text x={paddingX - 8} y={svgHeight - paddingBottom + 4} fill="#9ca3af" fontSize="11px" fontWeight="500" textAnchor="end">0%</text>
                  {points2.length > 1 && <path d={areaD2} fill="url(#gradientArea2)" />}
                  <path d={pathD2} fill="none" stroke="#ef4444" strokeWidth="3" strokeLinejoin="round" />
                  
                  {points2.map((p, i) => {
                    const isSelected = isPointSelected(p, i, 'vcto');
                    return isSelected ? <circle key={`sel2-${i}`} cx={p.x} cy={p.y} r="5" fill="#ef4444" stroke="#fff" strokeWidth="2" /> : null;
                  })}
                  {points2.map((p, i) => {
                    if (i % step !== 0 && i !== points2.length - 1) return null;
                    const isSelected = isPointSelected(p, i, 'vcto');
                    return <text key={`lab2-${i}`} x={p.x} y={svgHeight - paddingBottom + 16} fill={isSelected ? "#ef4444" : "#6b7280"} fontSize="11px" fontWeight={isSelected ? "700" : "400"} textAnchor="end" transform={`rotate(-45, ${p.x}, ${svgHeight - paddingBottom + 16})`}>{p.label}</text>;
                  })}
                  {hoveredIndex2 !== null && (
                    <g>
                      <line x1={points2[hoveredIndex2].x} y1={paddingTop} x2={points2[hoveredIndex2].x} y2={svgHeight - paddingBottom} stroke="#9ca3af" strokeWidth="1" strokeDasharray="4 4" />
                      <circle cx={points2[hoveredIndex2].x} cy={points2[hoveredIndex2].y} r="5" fill="#fff" stroke="#ef4444" strokeWidth="2" />
                      <rect x={points2[hoveredIndex2].x - 35} y={points2[hoveredIndex2].y - 35} width="70" height="26" rx="4" fill="#111827" opacity="0.9" />
                      <text x={points2[hoveredIndex2].x} y={points2[hoveredIndex2].y - 18} fill="#fff" fontSize="12px" fontWeight="600" textAnchor="middle">{points2[hoveredIndex2].pctAtraso.toFixed(1)}%</text>
                    </g>
                  )}
                  {points2.map((p, i) => (
                    <rect key={`interact2-${i}`} x={p.x - segmentWidth / 2} y={paddingTop} width={segmentWidth} height={chartHeight} fill="transparent"
                      onMouseDown={(e) => { e.preventDefault(); setDragState({ isDragging: true, startIndex: i, currentIndex: i, type: 'vcto' }); }}
                      onMouseEnter={() => { setHoveredIndex2(i); if (dragState.isDragging && dragState.type === 'vcto') setDragState(prev => ({...prev, currentIndex: i})); }}
                      onMouseLeave={() => setHoveredIndex2(null)}
                      style={{ cursor: "crosshair" }}
                    />
                  ))}
                </svg>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "24px" }}>
            <div style={chartBoxStyle}>
              <h3 style={{ margin: "0 0 16px 0", color: "#111827", fontSize: "16px", fontWeight: "600" }}>
                Evolução da Taxa Média <span style={{fontSize: "12px", color:"#9ca3af", fontWeight: "400"}}>(Emissão)</span>
              </h3>
              <div style={{ position: "relative", width: "100%", height: "auto" }}>
                <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ width: "100%", height: "auto", overflow: "visible" }}>
                  <defs><linearGradient id="gradientArea3" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity="0.4" /><stop offset="100%" stopColor="#10b981" stopOpacity="0.0" /></linearGradient></defs>
                  {renderHighlight(points3, 'emis', '16, 185, 129')}
                  <line x1={paddingX} y1={paddingTop} x2={svgWidth - paddingRight} y2={paddingTop} stroke="#f3f4f6" strokeWidth="1" />
                  <line x1={paddingX} y1={paddingTop + chartHeight / 2} x2={svgWidth - paddingRight} y2={paddingTop + chartHeight / 2} stroke="#f3f4f6" strokeWidth="1" />
                  <line x1={paddingX} y1={svgHeight - paddingBottom} x2={svgWidth - paddingRight} y2={svgHeight - paddingBottom} stroke="#e5e7eb" strokeWidth="1" />
                  <text x={paddingX - 8} y={paddingTop + 4} fill="#9ca3af" fontSize="11px" fontWeight="500" textAnchor="end">{formatAxisRate(maxVal3)}</text>
                  <text x={paddingX - 8} y={paddingTop + chartHeight / 2 + 4} fill="#9ca3af" fontSize="11px" fontWeight="500" textAnchor="end">{formatAxisRate(maxVal3 / 2)}</text>
                  <text x={paddingX - 8} y={svgHeight - paddingBottom + 4} fill="#9ca3af" fontSize="11px" fontWeight="500" textAnchor="end">0%</text>
                  {points3.length > 1 && <path d={areaD3} fill="url(#gradientArea3)" />}
                  <path d={pathD3} fill="none" stroke="#10b981" strokeWidth="3" strokeLinejoin="round" />
                  
                  {points3.map((p, i) => {
                    const isSelected = isPointSelected(p, i, 'emis');
                    return isSelected ? <circle key={`sel3-${i}`} cx={p.x} cy={p.y} r="5" fill="#10b981" stroke="#fff" strokeWidth="2" /> : null;
                  })}
                  {points3.map((p, i) => {
                    if (i % step !== 0 && i !== points3.length - 1) return null;
                    const isSelected = isPointSelected(p, i, 'emis');
                    return <text key={`lab3-${i}`} x={p.x} y={svgHeight - paddingBottom + 16} fill={isSelected ? "#10b981" : "#6b7280"} fontSize="11px" fontWeight={isSelected ? "700" : "400"} textAnchor="end" transform={`rotate(-45, ${p.x}, ${svgHeight - paddingBottom + 16})`}>{p.label}</text>;
                  })}
                  {hoveredIndex3 !== null && (
                    <g>
                      <line x1={points3[hoveredIndex3].x} y1={paddingTop} x2={points3[hoveredIndex3].x} y2={svgHeight - paddingBottom} stroke="#9ca3af" strokeWidth="1" strokeDasharray="4 4" />
                      <circle cx={points3[hoveredIndex3].x} cy={points3[hoveredIndex3].y} r="5" fill="#fff" stroke="#10b981" strokeWidth="2" />
                      <rect x={points3[hoveredIndex3].x - 35} y={points3[hoveredIndex3].y - 35} width="70" height="26" rx="4" fill="#111827" opacity="0.9" />
                      <text x={points3[hoveredIndex3].x} y={points3[hoveredIndex3].y - 18} fill="#fff" fontSize="12px" fontWeight="600" textAnchor="middle">{points3[hoveredIndex3].avgRate.toFixed(2).replace('.',',')}%</text>
                    </g>
                  )}
                  {points3.map((p, i) => (
                    <rect key={`interact3-${i}`} x={p.x - segmentWidth / 2} y={paddingTop} width={segmentWidth} height={chartHeight} fill="transparent"
                      onMouseDown={(e) => { e.preventDefault(); setDragState({ isDragging: true, startIndex: i, currentIndex: i, type: 'emis' }); }}
                      onMouseEnter={() => { setHoveredIndex3(i); if (dragState.isDragging && dragState.type === 'emis') setDragState(prev => ({...prev, currentIndex: i})); }}
                      onMouseLeave={() => setHoveredIndex3(null)}
                      style={{ cursor: "crosshair" }}
                    />
                  ))}
                </svg>
              </div>
            </div>

            <div style={chartBoxStyle}>
              <h3 style={{ margin: "0 0 16px 0", color: "#111827", fontSize: "16px", fontWeight: "600" }}>
                Evolução do Deságio <span style={{fontSize: "12px", color:"#9ca3af", fontWeight: "400"}}>(Emissão)</span>
              </h3>
              <div style={{ position: "relative", width: "100%", height: "auto" }}>
                <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ width: "100%", height: "auto", overflow: "visible" }}>
                  <defs><linearGradient id="gradientArea4" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f59e0b" stopOpacity="0.4" /><stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" /></linearGradient></defs>
                  {renderHighlight(points4, 'emis', '245, 158, 11')}
                  <line x1={paddingX} y1={paddingTop} x2={svgWidth - paddingRight} y2={paddingTop} stroke="#f3f4f6" strokeWidth="1" />
                  <line x1={paddingX} y1={paddingTop + chartHeight / 2} x2={svgWidth - paddingRight} y2={paddingTop + chartHeight / 2} stroke="#f3f4f6" strokeWidth="1" />
                  <line x1={paddingX} y1={svgHeight - paddingBottom} x2={svgWidth - paddingRight} y2={svgHeight - paddingBottom} stroke="#e5e7eb" strokeWidth="1" />
                  <text x={paddingX - 8} y={paddingTop + 4} fill="#9ca3af" fontSize="11px" fontWeight="500" textAnchor="end">{formatAxisVal(maxVal4)}</text>
                  <text x={paddingX - 8} y={paddingTop + chartHeight / 2 + 4} fill="#9ca3af" fontSize="11px" fontWeight="500" textAnchor="end">{formatAxisVal(maxVal4 / 2)}</text>
                  <text x={paddingX - 8} y={svgHeight - paddingBottom + 4} fill="#9ca3af" fontSize="11px" fontWeight="500" textAnchor="end">0</text>
                  {points4.length > 1 && <path d={areaD4} fill="url(#gradientArea4)" />}
                  <path d={pathD4} fill="none" stroke="#f59e0b" strokeWidth="3" strokeLinejoin="round" />
                  
                  {points4.map((p, i) => {
                    const isSelected = isPointSelected(p, i, 'emis');
                    return isSelected ? <circle key={`sel4-${i}`} cx={p.x} cy={p.y} r="5" fill="#f59e0b" stroke="#fff" strokeWidth="2" /> : null;
                  })}
                  {points4.map((p, i) => {
                    if (i % step !== 0 && i !== points4.length - 1) return null;
                    const isSelected = isPointSelected(p, i, 'emis');
                    return <text key={`lab4-${i}`} x={p.x} y={svgHeight - paddingBottom + 16} fill={isSelected ? "#f59e0b" : "#6b7280"} fontSize="11px" fontWeight={isSelected ? "700" : "400"} textAnchor="end" transform={`rotate(-45, ${p.x}, ${svgHeight - paddingBottom + 16})`}>{p.label}</text>;
                  })}
                  {hoveredIndex4 !== null && (
                    <g>
                      <line x1={points4[hoveredIndex4].x} y1={paddingTop} x2={points4[hoveredIndex4].x} y2={svgHeight - paddingBottom} stroke="#9ca3af" strokeWidth="1" strokeDasharray="4 4" />
                      <circle cx={points4[hoveredIndex4].x} cy={points4[hoveredIndex4].y} r="5" fill="#fff" stroke="#f59e0b" strokeWidth="2" />
                      <rect x={points4[hoveredIndex4].x - 60} y={points4[hoveredIndex4].y - 35} width="120" height="26" rx="4" fill="#111827" opacity="0.9" />
                      <text x={points4[hoveredIndex4].x} y={points4[hoveredIndex4].y - 18} fill="#fff" fontSize="11px" fontWeight="600" textAnchor="middle">{fmtM(points4[hoveredIndex4].value)}</text>
                    </g>
                  )}
                  {points4.map((p, i) => (
                    <rect key={`interact4-${i}`} x={p.x - segmentWidth / 2} y={paddingTop} width={segmentWidth} height={chartHeight} fill="transparent"
                      onMouseDown={(e) => { e.preventDefault(); setDragState({ isDragging: true, startIndex: i, currentIndex: i, type: 'emis' }); }}
                      onMouseEnter={() => { setHoveredIndex4(i); if (dragState.isDragging && dragState.type === 'emis') setDragState(prev => ({...prev, currentIndex: i})); }}
                      onMouseLeave={() => setHoveredIndex4(null)}
                      style={{ cursor: "crosshair" }}
                    />
                  ))}
                </svg>
              </div>
            </div>

          </div>
        </div>
      </CollapsePanel>
    </div>
  );
}

// --- COMPONENTE DE INSIGHTS ---
function DashboardInsights({ processedRows, insightFilter, setInsightFilter, setBorderoFilter, setDctoFilter, hideValues }) {
  const fmtM = (v) => hideValues ? "R$ -" : formatarMoeda(v);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hoveredSlice, setHoveredSlice] = useState(null);
  const [tooltip, setTooltip] = useState({ show: false, x: 0, y: 0, label: '', count: 0, value: 0 });

  const stats = useMemo(() => {
    const counts = { liquidado: 0, liquidadoAtraso: 0, atraso: 0, aVencer: 0, recompra: 0, total: 0 };
    const values = { liquidado: 0, liquidadoAtraso: 0, atraso: 0, aVencer: 0, recompra: 0, total: 0 };
    const delayDaysTotal = { liquidadoAtraso: 0, atraso: 0, recompra: 0 };
    const desagioValues = { liquidado: 0, liquidadoAtraso: 0, atraso: 0, aVencer: 0, recompra: 0, total: 0 };
    let sumWeightedDiasAVencer = 0;
    let sumValAVencer = 0;
    
    if (processedRows.length === 0) return { counts, values, avgDelays: { liquidadoAtraso: 0, atraso: 0, recompra: 0 }, desagioValues, prazoMedioAVencer: 0 };

    const seenBorderosStatus = { liquidado: new Set(), liquidadoAtraso: new Set(), atraso: new Set(), aVencer: new Set(), recompra: new Set(), invalido: new Set() };
    const seenBorderosTotal = new Set();
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const firstRow = processedRows[0];
    const entradaKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'entrada' || k.toLowerCase().includes('valor'));
    const borderoKey = Object.keys(firstRow).find(k => k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes("border"));
    const desagioKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'desagio' || k.toLowerCase() === 'deságio');
    const vctoKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'vcto' || (k.toLowerCase().includes('vcto') && !k.toLowerCase().includes('vl')));
    const pgtoKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'pgto' || (k.toLowerCase().includes('pgto') && !k.toLowerCase().includes('vl')));

    processedRows.forEach((r, idx) => {
      if (r._status !== 'invalido') {
        counts[r._status]++; counts.total++;
        const val = entradaKey ? (Number(r[entradaKey]) || 0) : 0;
        values[r._status] += val; values.total += val;

        const bNum = (borderoKey && r[borderoKey]) ? String(r[borderoKey]).trim() : `avulso_${idx}`; 
        const desagioVal = desagioKey ? (Number(r[desagioKey]) || 0) : 0;

        if (!seenBorderosStatus[r._status].has(bNum)) {
          seenBorderosStatus[r._status].add(bNum);
          desagioValues[r._status] += desagioVal;
        }
        if (!seenBorderosTotal.has(bNum)) {
          seenBorderosTotal.add(bNum);
          desagioValues.total += desagioVal;
        }

        if (r._status === 'liquidadoAtraso' || r._status === 'atraso' || r._status === 'recompra') {
          if (vctoKey && r[vctoKey]) {
            const effectiveVcto = new Date(String(r[vctoKey]).split("T")[0] + "T00:00:00");
            if (effectiveVcto.getDay() === 6) effectiveVcto.setDate(effectiveVcto.getDate() + 2);
            else if (effectiveVcto.getDay() === 0) effectiveVcto.setDate(effectiveVcto.getDate() + 1);

            if (r._status === 'liquidadoAtraso') {
              if (pgtoKey && r[pgtoKey]) {
                const pgtoDate = new Date(String(r[pgtoKey]).split("T")[0] + "T00:00:00");
                const diffTime = pgtoDate - effectiveVcto;
                if (diffTime > 0) delayDaysTotal.liquidadoAtraso += Math.floor(diffTime / (1000 * 60 * 60 * 24));
              }
            } else if (r._status === 'atraso') {
              const diffTime = today - effectiveVcto;
              if (diffTime > 0) delayDaysTotal.atraso += Math.floor(diffTime / (1000 * 60 * 60 * 24));
            } else if (r._status === 'recompra') {
              if (pgtoKey && r[pgtoKey]) {
                const pgtoDate = new Date(String(r[pgtoKey]).split("T")[0] + "T00:00:00");
                const diffTime = pgtoDate - effectiveVcto;
                if (diffTime > 0) delayDaysTotal.recompra += Math.floor(diffTime / (1000 * 60 * 60 * 24));
              } else {
                const diffTime = today - effectiveVcto;
                if (diffTime > 0) delayDaysTotal.recompra += Math.floor(diffTime / (1000 * 60 * 60 * 24));
              }
            }
          }
        }

        if (r._status === 'aVencer' && vctoKey && r[vctoKey]) {
          const effectiveVcto = new Date(String(r[vctoKey]).split("T")[0] + "T00:00:00");
          if (effectiveVcto.getDay() === 6) effectiveVcto.setDate(effectiveVcto.getDate() + 2);
          else if (effectiveVcto.getDay() === 0) effectiveVcto.setDate(effectiveVcto.getDate() + 1);
          
          const diffTime = effectiveVcto - today;
          if (diffTime > 0) {
            const diasRestantes = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            const val = entradaKey ? (Number(r[entradaKey]) || 0) : 0;
            
            if (val > 0) {
              sumWeightedDiasAVencer += (diasRestantes * val);
              sumValAVencer += val;
            }
          }
        }
      }
    });

    const avgDelays = {
      liquidadoAtraso: counts.liquidadoAtraso > 0 ? (delayDaysTotal.liquidadoAtraso / counts.liquidadoAtraso).toFixed(1).replace('.', ',') : 0,
      atraso: counts.atraso > 0 ? (delayDaysTotal.atraso / counts.atraso).toFixed(1).replace('.', ',') : 0,
      recompra: counts.recompra > 0 ? (delayDaysTotal.recompra / counts.recompra).toFixed(1).replace('.', ',') : 0
    };

        // Substitua o Math.round por esta lógica:
    const prazoMedioAVencer = sumValAVencer > 0 
      ? (sumWeightedDiasAVencer / sumValAVencer).toFixed(1).replace('.', ',') 
      : "0,0";

    return { counts, values, avgDelays, desagioValues, prazoMedioAVencer };
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

  const renderCard = (key, corPura, titulo, contagem, valorReal, mediaAtraso = null, desagioVal = 0, prazoMedio = null, prazoLabel = "Prazo Médio") => {
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
            <div style={{ fontSize: "16px", fontWeight: "700", color: "#111827", lineHeight: "1" }}>{fmtM(valorReal)}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "4px" }}>
            <div style={{ fontSize: "12px", color: "#6b7280", fontWeight: "600" }}>{stats.values.total > 0 ? ((valorReal / stats.values.total) * 100).toFixed(1) : 0}%</div>
            <div style={{ fontSize: "11px", color: "#9ca3af" }}>do Capital Total</div>
          </div>
        </div>
        
        <hr style={{ border: 0, borderTop: "1px dashed #d1d5db", margin: "14px 0", width: "100%" }} />
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
            <div style={{ fontSize: "16px", fontWeight: "700", color: "#111827", lineHeight: "1" }}>{fmtM(desagioVal)}</div>
          </div>
          <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "4px" }}>Deságio Total</div>
        </div>

        {mediaAtraso !== null && (
          <>
            <hr style={{ border: 0, borderTop: "1px dashed #d1d5db", margin: "14px 0", width: "100%" }} />
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                <div style={{ fontSize: "16px", fontWeight: "700", color: "#111827", lineHeight: "1" }}>{mediaAtraso} <span style={{fontSize: "12px", fontWeight: "600", color: "#6b7280"}}>dias</span></div>
              </div>
              <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "4px" }}>Média de Atraso</div>
            </div>
          </>
        )}
        {prazoMedio !== null && (
          <>
            <hr style={{ border: 0, borderTop: "1px dashed #d1d5db", margin: "14px 0", width: "100%" }} />
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                <div style={{ fontSize: "16px", fontWeight: "700", color: "#111827", lineHeight: "1" }}>{prazoMedio} <span style={{fontSize: "12px", fontWeight: "600", color: "#6b7280"}}>dias</span></div>
              </div>
              <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "4px" }}>{prazoLabel}</div>
            </div>
          </>
        )}
      </div>
    );
  };

return (
    <div style={{ background: "#fff", padding: "24px", borderRadius: "12px", boxShadow: "0 8px 20px rgba(0, 0, 0, 0.06)", border: "1px solid #e5e7eb" }}>
      <div onClick={() => setIsCollapsed(!isCollapsed)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none" }}>
        <h2 style={{ margin: 0, fontSize: "16px", fontWeight: "700", color: "#374151" }}>Visão Geral (Insights)</h2>
        <span style={{ background: "transparent", border: "1px solid #d1d5db", padding: "4px 10px", borderRadius: "6px", color: "#4b5563", fontSize: "12px", fontWeight: "600", display: "flex", alignItems: "center", gap: "6px" }}>
          Insights
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{transition:"transform 0.35s cubic-bezier(0.4,0,0.2,1)",transform:isCollapsed?"rotate(0deg)":"rotate(180deg)"}}><polyline points="6 9 12 15 18 9"/></svg>
        </span>
      </div>

      <CollapsePanel isCollapsed={isCollapsed}>
        <div style={{ paddingTop: "24px" }}>
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
                <span style={{ fontSize: "16px", fontWeight: "700", color: "#111827" }}>{fmtM(stats.values.total)}</span>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px", flex: 1 }}>
              {renderCard('liquidado', "#22c55e", "Liquidado em dia", stats.counts.liquidado, stats.values.liquidado, null, stats.desagioValues.liquidado)}
              {renderCard('liquidadoAtraso', "#f59e0b", "Liquidado c/ atraso", stats.counts.liquidadoAtraso, stats.values.liquidadoAtraso, stats.avgDelays.liquidadoAtraso, stats.desagioValues.liquidadoAtraso)}
              {renderCard('atraso', "#ef4444", "Em atraso", stats.counts.atraso, stats.values.atraso, stats.avgDelays.atraso, stats.desagioValues.atraso)}
              {renderCard('recompra', "#8b5cf6", "Recompra", stats.counts.recompra, stats.values.recompra, stats.avgDelays.recompra, stats.desagioValues.recompra)}
              {renderCard('aVencer', "#94a3b8", "A Vencer", stats.counts.aVencer, stats.values.aVencer, null, stats.desagioValues.aVencer, stats.prazoMedioAVencer, "Dias p/ Vencer")}
            </div>
          </div>
          {insightFilter && <div style={{ marginTop: "16px", fontSize: "13px", color: "#2563eb", fontWeight: "500", textAlign: "right" }}>Filtro de status ativo. Clique no card novamente para limpar.</div>}
          {tooltip.show && (
            <div style={{ position: 'fixed', top: tooltip.y + 15, left: tooltip.x + 15, background: 'rgba(17, 24, 39, 0.9)', color: '#fff', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', pointerEvents: 'none', zIndex: 9999 }}>
              <div style={{ fontWeight: 600 }}>{tooltip.label}</div>
              <div style={{ marginTop: '4px', fontSize: '15px', fontWeight: 700 }}>{tooltip.count} títulos</div>
              <div style={{ marginTop: '2px', fontSize: '13px', color: '#10b981' }}>{fmtM(tooltip.value)}</div>
            </div>
          )}
        </div>
      </CollapsePanel>
    </div>
  );
}

// --- COMPONENTE DA TABELA (OTIMIZADA COM PAGINAÇÃO) ---


function SacadoConcentrationCard({
  rows,
  clienteSelecionado,
  grupoSelecionado,
  sacadoSelecionado,
  setSacadoSelecionado,
  hideValues
}) {
  const [hoveredKey, setHoveredKey] = useState(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [tooltip, setTooltip] = useState({ show: false, x: 0, y: 0, label: '', value: 0, pct: 0 });
  const fmtM = (v) => hideValues ? "R$ -" : formatarMoeda(v);

  const data = useMemo(() => {
    if ((!clienteSelecionado && !grupoSelecionado) || !rows.length) return [];

    const firstRow = rows[0];
    const entradaKey =
      Object.keys(firstRow).find(
        (k) => k.toLowerCase() === "entrada" || (k.toLowerCase().includes("valor") && !k.toLowerCase().includes("pgto"))
      ) || "Entrada";

    const agrupado = new Map();

    rows.forEach((r) => {
      const sacado = String(r.Sacado || "").trim();
      const status = r._status;

      if (!sacadoValido(sacado)) return;
      if (status !== "aVencer" && status !== "atraso") return;

      const valor = Number(r[entradaKey]) || 0;
      if (valor <= 0) return;

      if (!agrupado.has(sacado)) {
        agrupado.set(sacado, { sacado, valor: 0, qtdTitulos: 0 });
      }

      const atual = agrupado.get(sacado);
      atual.valor += valor;
      atual.qtdTitulos += 1;
    });

    const arr = Array.from(agrupado.values()).sort((a, b) => b.valor - a.valor);
    const total = arr.reduce((acc, item) => acc + item.valor, 0);

    return arr.map((item) => ({
      ...item,
      pct: total > 0 ? (item.valor / total) * 100 : 0,
      total,
    }));
  }, [rows, clienteSelecionado, grupoSelecionado]);

  if (!clienteSelecionado && !grupoSelecionado) return null;

  const totalCapital = data[0]?.total || 0;
  const size = 240;
  const strokeWidth = 22;
  const radius = 50 - strokeWidth / 2;
  const circumference = 2 * Math.PI * radius;

  let accPct = 0;
  const palette = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#f97316", "#6366f1", "#84cc16"];

  const enriched = data.map((item, idx) => {
    const color = palette[idx % palette.length];
    const strokeDasharray = `${(item.pct / 100) * circumference} ${circumference}`;
    const strokeDashoffset = -((accPct / 100) * circumference);
    accPct += item.pct;
    return { ...item, color, strokeDasharray, strokeDashoffset };
  });

  const top5Pct = enriched.slice(0, 5).reduce((acc, item) => acc + item.pct, 0);

  const handleDonutMouseMove = (e, item) => {
    setTooltip({
      show: true,
      x: e.clientX,
      y: e.clientY,
      label: item.sacado,
      value: item.valor,
      pct: item.pct,
    });
    setHoveredKey(item.sacado);
  };

  const clearDonutHover = () => {
    setTooltip((prev) => ({ ...prev, show: false }));
    setHoveredKey(null);
  };

  return (
    <div style={concentrationCardStyle}>
      <div
        onClick={() => setIsCollapsed(!isCollapsed)}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "16px",
          flexWrap: "wrap",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <div>
          <h2 style={sectionTitleStyle}>Concentração por Sacado</h2>
        </div>

        <span style={{ background: "transparent", border: "1px solid #d1d5db", padding: "4px 10px", borderRadius: "6px", color: "#4b5563", fontSize: "12px", fontWeight: "600", display: "flex", alignItems: "center", gap: "6px" }}>
          Concentração
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "transform 0.35s cubic-bezier(0.4,0,0.2,1)", transform: isCollapsed ? "rotate(0deg)" : "rotate(180deg)" }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </div>

      <CollapsePanel isCollapsed={isCollapsed}>
        <div style={{ paddingTop: "24px" }}>
          {!data.length ? (
            <div style={{ padding: "28px 20px", textAlign: "center", color: "#6b7280", border: "1px dashed #d1d5db", borderRadius: "12px", background: "#fafafa" }}>
              Não há capital em aberto por sacado para a seleção atual.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) minmax(0, 1fr)", gap: "24px", alignItems: "stretch" }}>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: "14px", background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)", padding: "22px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 400 }}>
                <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", marginBottom: "18px" }}>
                  <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.2 }}>Capital em aberto</div>
                  <div style={{ fontSize: 28, color: "#111827", fontWeight: 800, lineHeight: 1.1, marginTop: 6, letterSpacing: "-0.02em", wordBreak: "break-word" }}>{fmtM(totalCapital)}</div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 8, lineHeight: 1.2, fontWeight: 600 }}>Top 5 = {hideValues ? "-" : `${top5Pct.toFixed(1).replace(".", ",")}%`}</div>
                </div>

                <div style={{ position: "relative", width: size, height: size }}>
                  <svg
                    viewBox="0 0 120 120"
                    style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}
                    onMouseLeave={clearDonutHover}
                  >
                    <circle cx="60" cy="60" r={radius} fill="none" stroke="#e5e7eb" strokeWidth={strokeWidth} />
                    {enriched.map((item) => {
                      const active = hoveredKey === item.sacado || sacadoSelecionado === item.sacado;
                      return (
                        <circle
                          key={item.sacado}
                          cx="60"
                          cy="60"
                          r={radius}
                          fill="none"
                          stroke={item.color}
                          strokeWidth={active ? strokeWidth + 2 : strokeWidth}
                          strokeDasharray={item.strokeDasharray}
                          strokeDashoffset={item.strokeDashoffset}
                          strokeLinecap="butt"
                          style={{ cursor: "pointer", transition: "all 0.2s ease", opacity: hoveredKey && hoveredKey !== item.sacado ? 0.35 : 1 }}
                          onMouseMove={(e) => handleDonutMouseMove(e, item)}
                          onMouseEnter={(e) => handleDonutMouseMove(e, item)}
                          onMouseLeave={clearDonutHover}
                          onClick={() => setSacadoSelecionado((prev) => prev === item.sacado ? "" : item.sacado)}
                        />
                      );
                    })}
                  </svg>
                </div>

                <div style={{ marginTop: 20, fontSize: 12, color: "#64748b", textAlign: "center", lineHeight: 1.6, maxWidth: 260 }}>
                  Passe o mouse para ver os detalhes e clique em um segmento para filtrar os títulos daquele sacado na tabela detalhada.
                </div>
              </div>

              <div style={{ border: "1px solid #e5e7eb", borderRadius: "14px", overflow: "hidden", background: "#fff" }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 170px 110px", gap: "12px", padding: "14px 16px", background: "#f8fafc", borderBottom: "1px solid #e5e7eb", fontSize: 12, color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  <div>Sacado</div>
                  <div style={{ textAlign: "right" }}>Capital em aberto</div>
                  <div style={{ textAlign: "right" }}>%</div>
                </div>

                <div style={{ maxHeight: 360, overflowY: "auto" }}>
                  {enriched.map((item) => {
                    const active = sacadoSelecionado === item.sacado;
                    return (
                      <div
                        key={item.sacado}
                        onClick={() => setSacadoSelecionado((prev) => prev === item.sacado ? "" : item.sacado)}
                        onMouseEnter={() => setHoveredKey(item.sacado)}
                        onMouseLeave={() => setHoveredKey(null)}
                        style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 170px 110px", gap: "12px", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid #f1f5f9", cursor: "pointer", background: active ? "#eef2ff" : hoveredKey === item.sacado ? "#f8fafc" : "#fff", transition: "all 0.18s ease" }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                          <span style={{ width: 10, height: 10, borderRadius: "50%", background: item.color, flex: "0 0 auto" }} />
                          <span style={{ color: active ? "#312e81" : "#111827", fontWeight: active ? 700 : 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={item.sacado}>{item.sacado}</span>
                        </div>
                        <div style={{ textAlign: "right", color: "#111827", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtM(item.valor)}</div>
                        <div style={{ textAlign: "right", color: active ? "#312e81" : "#475569", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{hideValues ? "-" : `${item.pct.toFixed(2).replace(".", ",")}%`}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </CollapsePanel>

      {tooltip.show && (
        <div style={{ position: 'fixed', top: tooltip.y + 15, left: tooltip.x + 15, background: 'rgba(17, 24, 39, 0.9)', color: '#fff', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', pointerEvents: 'none', zIndex: 9999 }}>
          <div style={{ fontWeight: 600 }}>{tooltip.label}</div>
          <div style={{ marginTop: '4px', fontSize: '15px', fontWeight: 700 }}>{fmtM(tooltip.value)}</div>
          <div style={{ marginTop: '2px', fontSize: '13px', color: '#10b981' }}>{hideValues ? '-' : `${tooltip.pct.toFixed(2).replace('.', ',')}%`}</div>
        </div>
      )}
    </div>
  );
}

const concentrationCardStyle = {
  background: "#fff",
  padding: "24px",
  borderRadius: "12px",
  boxShadow: "0 8px 20px rgba(0, 0, 0, 0.06)",
  border: "1px solid #e5e7eb",
};

const concentrationSummaryPill = {
  background: "#f8fafc",
  border: "1px solid #e5e7eb",
  borderRadius: "12px",
  padding: "12px 14px",
  minWidth: "220px",
};

const sectionTitleStyle = {
  margin: 0,
  fontSize: "16px",
  fontWeight: "700",
  color: "#374151",
};

const sectionSubtitleStyle = {
  margin: "4px 0 0 0",
  fontSize: "12px",
  color: "#6b7280",
};

function SimpleTable({ rows, clienteSelecionado, sacadoSelecionado, dateFilter, borderoFilter, setBorderoFilter, dctoFilter, setDctoFilter, setDateFilter, setInsightFilter, setClienteSelecionado, setSacadoSelecionado, hideValues }) {
  const fmtM = (v) => hideValues ? "R$ -" : formatarMoeda(v);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [sortConfig, setSortConfig] = useState(null);
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  useEffect(() => { setCurrentPage(1); }, [rows, dateFilter, sortConfig]);

  const colunasOcultas = ["id", "created_at", "Cód.Red", "UF", "Banco", "Rec.", "Estado", "_status"];
  const columns = useMemo(() => {
    if (!rows.length) return [];
    const firstRowKeys = Object.keys(rows[0]);
    let cols = firstRowKeys.filter(c => !colunasOcultas.includes(c));
    if (clienteSelecionado) cols = cols.filter(c => c !== "Cliente");
    if (sacadoSelecionado) cols = cols.filter(c => c !== "Sacado");
    if (clienteSelecionado && !sacadoSelecionado && cols.includes("Sacado")) cols = ["Sacado", ...cols.filter(c => c !== "Sacado")];
    else if (sacadoSelecionado && !clienteSelecionado && cols.includes("Cliente")) cols = ["Cliente", ...cols.filter(c => c !== "Cliente")];
    return cols;
  }, [rows, clienteSelecionado, sacadoSelecionado]);

  const activeSort = useMemo(() => {
    if (sortConfig) return sortConfig;
    if (rows.length === 0) return null;
    if (dateFilter?.type === 'emis') {
      const emisKey = Object.keys(rows[0]).find(k => k.toLowerCase().includes('emis'));
      if (emisKey) return { key: emisKey, direction: 'asc' };
    }
    if (dateFilter?.type === 'vcto') {
      const vctoKey = Object.keys(rows[0]).find(k => k.toLowerCase().includes('vcto') && !k.toLowerCase().includes('vl'));
      if (vctoKey) return { key: vctoKey, direction: 'asc' };
    }
    const defaultDateKey = Object.keys(rows[0]).find(k => k.toLowerCase().includes('vcto') && !k.toLowerCase().includes('vl')) || Object.keys(rows[0]).find(k => k.toLowerCase().includes('pgto') && !k.toLowerCase().includes('vl'));
    if (defaultDateKey) return { key: defaultDateKey, direction: 'desc' };
    return null;
  }, [sortConfig, rows, dateFilter]);

  const rowsWithEncargo = useMemo(() => {
    if (!rows.length) return rows;
    const firstRow = rows[0];
    const vlPgtoKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'vl pgto');
    const pgtoKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'pgto' || (k.toLowerCase().includes('pgto') && !k.toLowerCase().includes('vl')));
    const valKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'entrada' || (k.toLowerCase().includes('valor') && !k.toLowerCase().includes('pgto')));
    return rows.map(r => {
      const vlPgto = vlPgtoKey ? (Number(r[vlPgtoKey]) || 0) : 0;
      const val = valKey ? (Number(r[valKey]) || 0) : 0;
      const temPgto = pgtoKey && r[pgtoKey] && String(r[pgtoKey]).trim() !== "";
      // Se vlPgto > 140% do valor de face, considera que não houve encargo (provavelmente dado inconsistente)
      const encargoPossivel = temPgto && vlPgto > 0 && val > 0 && vlPgto !== val;
      const encargoDentroLimite = encargoPossivel && vlPgto <= val * 1.4;
      const encargoCalculado = encargoDentroLimite ? (vlPgto - val) : 0;
      const encargo = encargoCalculado > 0 ? encargoCalculado : 0;
      return { ...r, __encargo__: encargo };
    });
  }, [rows]);

  const sortedRows = useMemo(() => {
    let sortableItems = [...rowsWithEncargo];
    if (activeSort !== null) {
      sortableItems.sort((a, b) => {
        let aValue = a[activeSort.key] || ""; let bValue = b[activeSort.key] || "";
        const keyLower = activeSort.key.toLowerCase();
        
        const isCurrency = keyLower === "entrada" || keyLower === "vl pgto" || keyLower.includes("valor") || keyLower === "desagio" || keyLower === "deságio" || keyLower === "__encargo__";
        const isRate = keyLower.includes("tx") || keyLower.includes("taxa");
        const isDateColumn = !isCurrency && !isRate && (keyLower.includes("emis") || keyLower.includes("vcto") || keyLower.includes("pgto") || keyLower.includes("data"));

        if (isDateColumn) {
          const dateA = new Date(aValue).getTime() || 0; const dateB = new Date(bValue).getTime() || 0;
          return activeSort.direction === 'asc' ? dateA - dateB : dateB - dateA;
        } else if (isCurrency || isRate) {
          let numA = Number(String(aValue).replace('%', '').replace(',', '.')) || 0;
          let numB = Number(String(bValue).replace('%', '').replace(',', '.')) || 0;
          return activeSort.direction === 'asc' ? numA - numB : numB - numA;
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

  const currentItems = sortedRows.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.ceil(sortedRows.length / itemsPerPage);

  const { totalFace, totalDesagio, totalEncargos, taxaMedia, valorMedio, prazoMedio } = useMemo(() => {
    if (sortedRows.length === 0) return { totalFace: 0, totalDesagio: 0, totalEncargos: 0, taxaMedia: 0, valorMedio: 0, prazoMedio: 0 };
    let f = 0; let d = 0; let enc = 0;
    let countTitulos = 0;
    let sumPrazoWeighted = 0;

    const seenBorderosDesagio = new Set();
    const borderoMapTaxa = new Map();
    const borderoMapTicket = new Map();
    const firstRow = sortedRows[0];
    const borderoKey = Object.keys(firstRow).find(k => k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes("border"));
    const valKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'entrada' || (k.toLowerCase().includes('valor') && !k.toLowerCase().includes('pgto')));
    const emisKey = Object.keys(firstRow).find(k => k.toLowerCase().includes('emis'));
    const vctoKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'vcto' || (k.toLowerCase().includes('vcto') && !k.toLowerCase().includes('vl')));
    const desagioKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'desagio' || k.toLowerCase() === 'deságio');
    const rateKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'tx.efet' || k.toLowerCase().includes('tx.efet') || k.toLowerCase().includes('tx efet'));

    sortedRows.forEach((row, idx) => {
      const bNum = (borderoKey && row[borderoKey]) ? String(row[borderoKey]).trim() : `avulso_${idx}`; 
      const val = valKey ? (Number(row[valKey]) || 0) : 0;

      if (!borderoMapTicket.has(bNum)) {
        borderoMapTicket.set(bNum, 0);
      }
      borderoMapTicket.set(bNum, borderoMapTicket.get(bNum) + val);

      f += val;
      if (val > 0) {
        countTitulos += 1;
        let prazo = 0;
        if (emisKey && row[emisKey] && vctoKey && row[vctoKey]) {
          const eDate = new Date(String(row[emisKey]).split("T")[0] + "T00:00:00");
          const vDate = new Date(String(row[vctoKey]).split("T")[0] + "T00:00:00");
          const diff = vDate - eDate;
          if (diff > 0) prazo = Math.round(diff / (1000 * 60 * 60 * 24));
        }
        sumPrazoWeighted += (prazo * val);
      }

      const desagioVal = desagioKey ? (Number(row[desagioKey]) || 0) : 0;
      if (!seenBorderosDesagio.has(bNum)) {
        seenBorderosDesagio.add(bNum);
        d += desagioVal;
      }

      // Usa o encargo pré-computado
      enc += (row.__encargo__ || 0);

      const rawRate = rateKey ? row[rateKey] : null;
      const hasRateVal = rawRate !== null && rawRate !== undefined && String(rawRate).trim() !== "";
      const rate = hasRateVal ? (Number(String(rawRate).replace('%', '').replace(',', '.')) || 0) : 0;

      if (!borderoMapTaxa.has(bNum)) {
        borderoMapTaxa.set(bNum, { totalValue: 0, rate: 0, hasRate: false });
      }
      const bData = borderoMapTaxa.get(bNum);
      bData.totalValue += val;
      if (!bData.hasRate && hasRateVal) {
        bData.rate = rate;
        bData.hasRate = true;
      }
    });

    let totalValueTaxa = 0;
    let weightedRateSum = 0;
    borderoMapTaxa.forEach(b => {
      if (b.hasRate && b.totalValue > 0) {
        weightedRateSum += (b.rate * b.totalValue);
        totalValueTaxa += b.totalValue;
      }
    });

    return { 
      totalFace: f, 
      totalDesagio: d,
      totalEncargos: enc,
      taxaMedia: totalValueTaxa > 0 ? (weightedRateSum / totalValueTaxa) : 0,
      valorMedio: borderoMapTicket.size > 0 ? f / borderoMapTicket.size : 0,
      prazoMedio: f > 0 ? (sumPrazoWeighted / f) : 0 
    };
  }, [sortedRows]);

  const requestSort = (key) => setSortConfig({ key, direction: activeSort?.key === key && activeSort.direction === 'asc' ? 'desc' : 'asc' });

  if (!rows.length) return null;

  return (
    <div style={{ background: "#fff", borderRadius: "12px", boxShadow: "0 8px 20px rgba(0, 0, 0, 0.06)", border: "1px solid #e5e7eb", display: "flex", flexDirection: "column" }}>
      
      <div onClick={() => setIsCollapsed(!isCollapsed)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", borderBottom: isCollapsed ? "none" : "1px solid #e5e7eb", cursor: "pointer", userSelect: "none", transition: "border-bottom 0.35s ease" }}>
        <h2 style={{ margin: 0, fontSize: "16px", fontWeight: "700", color: "#374151" }}>Registos Detalhados</h2>
        <span style={{ background: "transparent", border: "1px solid #d1d5db", padding: "4px 10px", borderRadius: "6px", color: "#4b5563", fontSize: "12px", fontWeight: "600", display: "flex", alignItems: "center", gap: "6px" }}>
          Tabela
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{transition:"transform 0.35s cubic-bezier(0.4,0,0.2,1)",transform:isCollapsed?"rotate(0deg)":"rotate(180deg)"}}><polyline points="6 9 12 15 18 9"/></svg>
        </span>
      </div>

      <CollapsePanel isCollapsed={isCollapsed}>
          <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "500px" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "14px", whiteSpace: "nowrap" }}>
              <thead>
                <tr>
                  {columns.map((c) => {
                    let labelColuna = c === "Entrada" ? "Valor de Face" : c === "Cliente" ? "Cedente" : c.toLowerCase() === "vcto" ? "Dt.Vcto" : c.toLowerCase() === "pgto" ? "Dt.Pgto" : c.toLowerCase() === "vl pgto" ? "Valor Pgto" : c;
                    const isSorted = activeSort?.key === c;
                    const isDesagioCol = c.toLowerCase() === 'desagio' || c.toLowerCase() === 'deságio';
                    return (
                      <React.Fragment key={c}>
                        <th onClick={() => requestSort(c)} style={{ borderBottom: "2px solid #e5e7eb", padding: "12px 16px", background: isSorted ? "#eff6ff" : "#f9fafb", color: isSorted ? "#1d4ed8" : "#374151", fontWeight: "600", textAlign: "left", position: "sticky", top: 0, zIndex: 10, cursor: "pointer", userSelect: "none" }}>
                          {labelColuna}{isSorted ? (activeSort.direction === 'asc' ? ' ↑' : ' ↓') : ''}
                        </th>
                        {isDesagioCol && (
                          <th key="__encargos_header__" onClick={() => requestSort("__encargo__")} style={{ borderBottom: "2px solid #e5e7eb", padding: "12px 16px", background: activeSort?.key === "__encargo__" ? "#fffbeb" : "#fffbeb", color: activeSort?.key === "__encargo__" ? "#78350f" : "#92400e", fontWeight: "600", textAlign: "left", position: "sticky", top: 0, zIndex: 10, cursor: "pointer", userSelect: "none" }}>
                            Encargos{activeSort?.key === "__encargo__" ? (activeSort.direction === 'asc' ? ' ↑' : ' ↓') : ''}
                          </th>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {currentItems.map((r, idx) => {
                  return (
                    <tr key={r.id ?? idx} className={`table-row-${r._status || 'default'}`} style={{ borderBottom: "1px solid #e5e7eb", transition: "background 0.2s" }}>
                      {columns.map((c) => {
                        let valor = r[c];
                        const cLower = c.toLowerCase();
                        const isCurrency = cLower === "entrada" || cLower === "vl pgto" || cLower.includes("valor") || cLower === "desagio" || cLower === "deságio";
                        const isRate = cLower.includes("tx") || cLower.includes("taxa");
                        const isDateColumn = !isCurrency && !isRate && (cLower.includes("emis") || cLower.includes("vcto") || cLower.includes("pgto") || cLower.includes("data"));
                        const isBorderoCol = cLower.normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes("border");
                        const isThisBorderoFiltered = borderoFilter?.key === c && borderoFilter?.value === valor;
                        const isDctoCol = cLower === "dcto" || cLower === "documento";
                        const baseValor = String(valor || "").split(/[-/]/)[0].trim();
                        const baseFiltered = dctoFilter ? String(dctoFilter.value).split(/[-/]/)[0].trim() : null;
                        const isThisDctoFiltered = dctoFilter?.key === c && baseValor === baseFiltered;
                        const isDesagioCol = cLower === 'desagio' || cLower === 'deságio';

                        if (isDateColumn) valor = formatarData(valor);
                        else if (isCurrency) valor = fmtM(valor);
                        else if (isRate) {
                          const valNum = Number(String(valor).replace('%', '').replace(',', '.'));
                          valor = !isNaN(valNum) && valor ? `${valNum.toFixed(2).replace('.', ',')}%` : escapeText(valor);
                        }

                        // Calcular encargo deste título
                        const encargoCellVal = isDesagioCol ? (r.__encargo__ || 0) : null;

                      return (
                        <React.Fragment key={c}>
                          <td style={{ padding: "12px 16px", color: "#374151" }}>
                            {isBorderoCol ? (
                              <span onClick={(e) => { e.stopPropagation(); if (isThisBorderoFiltered) setBorderoFilter(null); else { setBorderoFilter({ key: c, value: valor }); setDctoFilter(null); setDateFilter({ type: 'emis', start: '', end: '' }); if (setInsightFilter) setInsightFilter(null); } }} style={{ background: isThisBorderoFiltered ? "#4f46e5" : "rgba(79, 70, 229, 0.08)", color: isThisBorderoFiltered ? "#fff" : "#4f46e5", padding: "4px 8px", borderRadius: "6px", fontWeight: "600", cursor: "pointer" }}>{escapeText(valor)}</span>
                            ) : isDctoCol ? (
                              <span onClick={(e) => { e.stopPropagation(); if (isThisDctoFiltered) setDctoFilter(null); else { setDctoFilter({ key: c, value: valor }); setBorderoFilter(null); setDateFilter({ type: 'emis', start: '', end: '' }); if (setInsightFilter) setInsightFilter(null); } }} style={{ background: isThisDctoFiltered ? "#0ea5e9" : "rgba(14, 165, 233, 0.08)", color: isThisDctoFiltered ? "#fff" : "#0ea5e9", padding: "4px 8px", borderRadius: "6px", fontWeight: "600", cursor: "pointer" }}>{escapeText(valor)}</span>
                            ) : c === "Cliente" ? (
                              <span onClick={(e) => { e.stopPropagation(); setClienteSelecionado(valor); }} className="clickable-entity">{escapeText(valor)}</span>
                            ) : c === "Sacado" ? (
                              <span onClick={(e) => { e.stopPropagation(); setSacadoSelecionado(valor); }} className="clickable-entity">{escapeText(valor)}</span>
                            ) : ( escapeText(valor) )}
                          </td>
                          {isDesagioCol && (
                            <td key="__encargos_cell__" style={{ padding: "12px 16px", color: encargoCellVal > 0 ? "#92400e" : "#9ca3af", fontWeight: encargoCellVal > 0 ? "600" : "400", background: encargoCellVal > 0 ? "rgba(245, 158, 11, 0.04)" : "transparent" }}>
                              {encargoCellVal > 0 ? fmtM(encargoCellVal) : "—"}
                            </td>
                          )}
                        </React.Fragment>
                      );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 24px', background: '#fff', borderTop: '1px solid #e5e7eb', alignItems: 'center' }}>
             <span style={{ fontSize: '13px', color: '#6b7280' }}>
               Mostrando {sortedRows.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0} a {Math.min(currentPage * itemsPerPage, sortedRows.length)} de {sortedRows.length} registos
             </span>
             <div style={{ display: 'flex', gap: '8px' }}>
               <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #d1d5db', background: currentPage === 1 ? '#f3f4f6' : '#fff', color: currentPage === 1 ? '#9ca3af' : '#374151', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', fontSize: '13px' }}>Anterior</button>
               <button disabled={currentPage === totalPages || totalPages === 0} onClick={() => setCurrentPage(p => p + 1)} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #d1d5db', background: currentPage === totalPages || totalPages === 0 ? '#f3f4f6' : '#fff', color: currentPage === totalPages || totalPages === 0 ? '#9ca3af' : '#374151', cursor: currentPage === totalPages || totalPages === 0 ? 'not-allowed' : 'pointer', fontSize: '13px' }}>Próxima</button>
             </div>
          </div>
          
          <div style={{ 
            padding: "18px 24px", 
            background: "#f8fafc", 
            borderTop: "2px solid #cbd5e1", 
            boxShadow: "inset 0px 4px 6px -4px rgba(0,0,0,0.05)",
            borderRadius: "0 0 12px 12px", 
            display: "flex", 
            justifyContent: "flex-end", 
            alignItems: "center",
            gap: "32px", 
            flexWrap: "wrap" 
          }}>
            <div>
              <span style={{ color: "#4b5563", fontWeight: "500", marginRight: "8px", fontSize: "14px" }}>Deságio Total:</span>
              <span style={{ color: "#0f172a", fontWeight: "700", fontSize: "18px" }}>{fmtM(totalDesagio)}</span>
            </div>
            <div>
              <span style={{ color: "#4b5563", fontWeight: "500", marginRight: "8px", fontSize: "14px" }}>Encargo Total:</span>
              <span style={{ color: "#92400e", fontWeight: "700", fontSize: "18px" }}>{fmtM(totalEncargos)}</span>
            </div>
            <div>
              <span style={{ color: "#4b5563", fontWeight: "500", marginRight: "8px", fontSize: "14px" }}>Ticket Médio:</span>
              <span style={{ color: "#0f172a", fontWeight: "700", fontSize: "18px" }}>{fmtM(valorMedio)}</span>
            </div>
            <div>
              <span style={{ color: "#4b5563", fontWeight: "500", marginRight: "8px", fontSize: "14px" }}>Prazo Médio:</span>
              <span style={{ color: "#0f172a", fontWeight: "700", fontSize: "18px" }}>{prazoMedio.toFixed(0)} <span style={{fontSize: "14px", fontWeight: "600", color: "#64748b"}}>dias</span></span>
            </div>
            <div>
              <span style={{ color: "#4b5563", fontWeight: "500", marginRight: "8px", fontSize: "14px" }}>Taxa Média:</span>
              <span style={{ color: "#0f172a", fontWeight: "700", fontSize: "18px" }}>{taxaMedia.toFixed(2).replace('.', ',')}%</span>
            </div>
            <div>
              <span style={{ color: "#4b5563", fontWeight: "500", marginRight: "8px", fontSize: "14px" }}>Valor de Face Total:</span>
              <span style={{ color: "#0f172a", fontWeight: "700", fontSize: "18px" }}>{fmtM(totalFace)}</span>
            </div>
          </div>
      </CollapsePanel>
    </div>
  );
}

// DROPDOWN CUSTOMIZADO
function CustomDropdown({ value, options, onChange, placeholder }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [isMobileDevice, setIsMobileDevice] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const checkMobile = () => setIsMobileDevice(window.innerWidth < 640);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    function handleClickOutside(event) { if (wrapperRef.current && !wrapperRef.current.contains(event.target)) { setIsOpen(false); setSearchTerm(""); } }
    document.addEventListener("mousedown", handleClickOutside); return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredOptions = options.filter(opt => opt.toLowerCase().includes(searchTerm.toLowerCase()));
  const handleKeyDown = (e) => { if (e.key === 'Enter') { e.preventDefault(); if (isOpen && filteredOptions.length > 0) { onChange(filteredOptions[0]); setSearchTerm(""); setIsOpen(false); } } };
  const displayValue = isOpen ? searchTerm : value;

  // Em mobile, usa select nativo para evitar que o teclado virtual cause resize e feche o sidebar
  if (isMobileDevice) {
    return (
      <div style={{ position: "relative", width: "100%" }}>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: "100%", padding: "11px", paddingRight: "32px", borderRadius: "6px", border: "1px solid #d1d5db", background: "#fff", fontSize: "14px", color: value ? "#111827" : "#9ca3af", outline: "none", boxSizing: "border-box", appearance: "none", WebkitAppearance: "none" }}
        >
          <option value="">{placeholder}</option>
          {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
        <div style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#6b7280", fontSize: "12px" }}>▼</div>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} style={{ position: "relative", width: "100%" }}>
      <input type="text" value={displayValue} onChange={(e) => { setSearchTerm(e.target.value); setIsOpen(true); }} onFocus={() => { setIsOpen(true); setSearchTerm(""); }} onKeyDown={handleKeyDown} placeholder={isOpen && value ? value : placeholder} style={{ width: "100%", padding: "11px", paddingRight: "32px", borderRadius: "6px", border: "1px solid #d1d5db", background: "#fff", fontSize: "14px", color: "#111827", outline: "none", boxSizing: "border-box", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} />
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
export default function MicroDashboard({ session, onSidebarToggle, hideValues, setHideValues }) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  
  const [viewMode, setViewMode] = useState('all'); 
  const [insightFilter, setInsightFilter] = useState(null);
  const [borderoFilter, setBorderoFilter] = useState(null); 
  const [dctoFilter, setDctoFilter] = useState(null); 
  
  const [relacionamentos, setRelacionamentos] = useState([]);
  const [clienteSelecionado, setClienteSelecionado] = useState("");
  const [grupoSelecionado, setGrupoSelecionado] = useState("");
  const [sacadoSelecionado, setSacadoSelecionado] = useState("");

  // ESTADOS DE CONTROLO DA SIDEBAR
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isTablet, setIsTablet] = useState(false);
  // Formata moeda ou mascara o valor se hideValues estiver ativo
  const fmtM = (valor) => hideValues ? "R$ -" : formatarMoeda(valor);

  const handleSidebarToggle = (val, mobile, tablet) => {
    setIsSidebarOpen(val);
    if (onSidebarToggle) onSidebarToggle(val, mobile, tablet);
  };

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      const mobile = w < 640;           // < 640px: overlay (flutua por cima)
      const tablet = w >= 640 && w < 1824; // 640–1023px: sidebar empurra conteúdo sem translado
      setIsMobile(mobile);
      setIsTablet(tablet);
      if (!mobile) {
        setIsSidebarOpen(true);
        if (onSidebarToggle) onSidebarToggle(true, mobile, tablet);
      } else {
        setIsSidebarOpen(false);
        if (onSidebarToggle) onSidebarToggle(false, mobile, tablet);
      }
    };

    if (typeof window !== 'undefined') {
      handleResize();
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, []);

  // ESTADOS DE DATA
  const [dateFilter, setDateFilter] = useState(() => {
    const init = getInitDateStr();
    return { type: 'emis', start: init.start, end: init.end };
  });
  const [activeQuickDate, setActiveQuickDate] = useState('ytd');
  
  const [inputType, setInputType] = useState("emis");
  const [inputDateStart, setInputDateStart] = useState(() => getInitDateStr().start);
  const [inputDateEnd, setInputDateEnd] = useState(() => getInitDateStr().end);

  // MEMÓRIA PARA ESTADO DE DATAS (LÓGICA DE UX)
  const latestDateFilter = useRef(dateFilter);
  const latestQuickDate = useRef(activeQuickDate);
  const savedDateFilter = useRef(null);
  const savedQuickDate = useRef(null);
  const prevHasEntity = useRef(false);

  useEffect(() => {
    latestDateFilter.current = dateFilter;
    latestQuickDate.current = activeQuickDate;
  }, [dateFilter, activeQuickDate]);

  const handleSetDateFilter = (newFilter) => {
    setActiveQuickDate(null);
    setDateFilter(newFilter);
  };

  useEffect(() => {
    setInputDateStart(dateFilter.start);
    setInputDateEnd(dateFilter.end);
    setInputType(dateFilter.type);
  }, [dateFilter]);

  useEffect(() => {
    const currentlyHasEntity = !!(clienteSelecionado || sacadoSelecionado || grupoSelecionado);

    if (currentlyHasEntity && !prevHasEntity.current) {
      savedDateFilter.current = latestDateFilter.current;
      savedQuickDate.current = latestQuickDate.current;
      
      setDateFilter(prev => ({ ...prev, start: '', end: '' }));
      setActiveQuickDate(null);
    } 
    else if (!currentlyHasEntity && prevHasEntity.current) {
      if (savedDateFilter.current) {
        setDateFilter(savedDateFilter.current);
        setActiveQuickDate(savedQuickDate.current);
      }
    }

    prevHasEntity.current = currentlyHasEntity;

    setInsightFilter(null); 
    setBorderoFilter(null); 
    setDctoFilter(null);
  }, [clienteSelecionado, sacadoSelecionado, grupoSelecionado]);

  const applyQuickDate = (quickType) => {
    if (activeQuickDate === quickType) {
      setActiveQuickDate(null);
      setDateFilter({ type: inputType, start: '', end: '' });
      return;
    }

    const end = new Date();
    let start = new Date();

    if (quickType === 'mes_atual') {
      start = new Date(end.getFullYear(), end.getMonth(), 1);
    } else if (quickType === 'ult_30') {
      start.setDate(end.getDate() - 30);
    } else if (quickType === 'ytd') {
      start = new Date(end.getFullYear(), 0, 1);
    } else if (quickType === 'ult_semestre') {
      start.setMonth(end.getMonth() - 6);
    } else if (quickType === 'ult_ano') {
      start.setFullYear(end.getFullYear() - 1);
    }

    const startStr = formatToLocalISO(start);
    const endStr = formatToLocalISO(end);

    setActiveQuickDate(quickType);
    setDateFilter({ type: inputType, start: startStr, end: endStr });
    setBorderoFilter(null);
    setDctoFilter(null);
  };

  const processedRows = useMemo(() => {
    if (rows.length === 0) return [];
    
    const firstRow = rows[0];
    const vctoKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'vcto' || (k.toLowerCase().includes('vcto') && !k.toLowerCase().includes('vl')));
    const pgtoKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'pgto' || (k.toLowerCase().includes('pgto') && !k.toLowerCase().includes('vl')));
    const statusKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'status' || k.toLowerCase() === 'estado');
    const today = new Date(); today.setHours(0, 0, 0, 0);

    return rows.map(r => {
      let status = 'invalido';
      const vctoVal = vctoKey ? r[vctoKey] : null; const pgtoVal = pgtoKey ? r[pgtoKey] : null;
      const statusVal = statusKey ? String(r[statusKey]).trim().toUpperCase() : "";

      if (statusVal === "REC" || statusVal.includes("REC")) status = 'recompra';
      else if (vctoVal) {
        const effectiveVcto = new Date(String(vctoVal).split("T")[0] + "T00:00:00");
        if (effectiveVcto.getDay() === 6) effectiveVcto.setDate(effectiveVcto.getDate() + 2);
        else if (effectiveVcto.getDay() === 0) effectiveVcto.setDate(effectiveVcto.getDate() + 1);

        if (pgtoVal && String(pgtoVal).trim() !== "") {
          const pgtoDate = new Date(String(pgtoVal).split("T")[0] + "T00:00:00");

          const clienteAtual = String(r["Cliente"] || "").trim();
          const diasTolerancia = getDiasUteisToleranciaComissaria(clienteAtual);
          const toleranciaFinal = diasTolerancia > 0
            ? adicionarDiasUteis(effectiveVcto, diasTolerancia)
            : effectiveVcto;

          if (pgtoDate <= toleranciaFinal) {
            status = 'liquidado';
          } else {
            status = 'liquidadoAtraso';
          }
        } else {
          if (effectiveVcto < today) status = 'atraso';
          else status = 'aVencer';
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

  const rowsFilteredByDate = useMemo(() => {
    let base = rowsFilteredByMode;
    if (dateFilter.start || dateFilter.end) {
       if (base.length === 0) return base;
       const firstRow = base[0];
       const key = dateFilter.type === 'emis' 
         ? Object.keys(firstRow).find(k => k.toLowerCase().includes('emis'))
         : Object.keys(firstRow).find(k => k.toLowerCase() === 'vcto' || (k.toLowerCase().includes('vcto') && !k.toLowerCase().includes('vl')));
       
       base = base.filter(r => {
          if (!key || !r[key]) return false;
          const dStr = String(r[key]).split("T")[0];
          
          if (dateFilter.start && dStr < dateFilter.start) return false;
          if (dateFilter.end && dStr > dateFilter.end) return false;
          return true;
       });
    }
    return base;
  }, [rowsFilteredByMode, dateFilter]);

  const evolutionRows = useMemo(() => {
    let base = rowsFilteredByMode;
    if (insightFilter) base = base.filter(r => r._status === insightFilter);
    return base;
  }, [rowsFilteredByMode, insightFilter]);

  const rowsParaTabela = useMemo(() => {
    let filtered = rowsFilteredByDate;
    if (insightFilter) filtered = filtered.filter(r => r._status === insightFilter);
    if (borderoFilter) filtered = filtered.filter(r => r[borderoFilter.key] === borderoFilter.value);
    if (dctoFilter) {
      const baseTarget = String(dctoFilter.value).split(/[-/]/)[0].trim();
      filtered = filtered.filter(r => String(r[dctoFilter.key] || "").split(/[-/]/)[0].trim() === baseTarget);
    }
    return filtered;
  }, [rowsFilteredByDate, insightFilter, borderoFilter, dctoFilter]);

  const rowsParaRiscoAtual = useMemo(() => {
  let filtered = rowsFilteredByMode;

  if (insightFilter) filtered = filtered.filter(r => r._status === insightFilter);
  if (borderoFilter) filtered = filtered.filter(r => r[borderoFilter.key] === borderoFilter.value);
  if (dctoFilter) {
    const baseTarget = String(dctoFilter.value).split(/[-/]/)[0].trim();
    filtered = filtered.filter(r => String(r[dctoFilter.key] || "").split(/[-/]/)[0].trim() === baseTarget);
  }

  return filtered.filter(r => ['aVencer', 'atraso'].includes(r._status));
}, [rowsFilteredByMode, insightFilter, borderoFilter, dctoFilter]);

const riscoAtual = useMemo(() => {
  if (!rowsParaRiscoAtual || rowsParaRiscoAtual.length === 0) return 0;

  const firstRow = rowsParaRiscoAtual[0];
  const valKey = Object.keys(firstRow).find(
    k => k.toLowerCase() === 'entrada' || (k.toLowerCase().includes('valor') && !k.toLowerCase().includes('pgto'))
  );

  if (!valKey) return 0;

  return rowsParaRiscoAtual.reduce((acc, row) => acc + (Number(row[valKey]) || 0), 0);
}, [rowsParaRiscoAtual]);

const kpiData = useMemo(() => {
    if (!rowsParaTabela || rowsParaTabela.length === 0) return { riscoAtual: 0, taxaMedia: 0, baseCalculo: 0, valorMedio: 0, prazoMedio: 0, desagioTotal: 0, encargosTotal: 0, diasOperacao: 0 };

    const borderoMap = new Map();
    let sumFaceTotal = 0;
    let sumPrazoWeighted = 0;
    let countTitulos = 0;

    const firstRow = rowsParaTabela[0];
    const borderoKey = Object.keys(firstRow).find(k => k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes("border"));
    const valKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'entrada' || (k.toLowerCase().includes('valor') && !k.toLowerCase().includes('pgto')));
    const vlPgtoKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'vl pgto');
    const pgtoKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'pgto' || (k.toLowerCase().includes('pgto') && !k.toLowerCase().includes('vl')));
    const rateKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'tx.efet' || k.toLowerCase().includes('tx.efet') || k.toLowerCase().includes('tx efet'));
    const emisKey = Object.keys(firstRow).find(k => k.toLowerCase().includes('emis'));
    const vctoKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'vcto' || (k.toLowerCase().includes('vcto') && !k.toLowerCase().includes('vl')));
    const desagioKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'desagio' || k.toLowerCase() === 'deságio');

    const seenBorderosDesagio = new Set();
    let totalDesagio = 0;
    let totalEncargos = 0;
    
    // Variáveis para rastrear os dias de operação
    let minDate = null;
    let maxDate = null;

    rowsParaTabela.forEach((r, idx) => {
      const bNum = (borderoKey && r[borderoKey]) ? String(r[borderoKey]).trim() : `avulso_${idx}`; 
      const val = valKey ? (Number(r[valKey]) || 0) : 0;

      const vlPgto = vlPgtoKey ? (Number(r[vlPgtoKey]) || 0) : 0;
      
      const rawRate = rateKey ? r[rateKey] : null;
      const hasRateVal = rawRate !== null && rawRate !== undefined && String(rawRate).trim() !== "";
      const rate = hasRateVal ? (Number(String(rawRate).replace('%', '').replace(',', '.')) || 0) : 0;

      const desagioVal = desagioKey ? (Number(r[desagioKey]) || 0) : 0;
      if (!seenBorderosDesagio.has(bNum)) {
         seenBorderosDesagio.add(bNum);
         totalDesagio += desagioVal;
      }

      // Encargo por título (não deduplicado por borderô)
      const temPgto = pgtoKey && r[pgtoKey] && String(r[pgtoKey]).trim() !== "";
      const encargoPossivel = temPgto && vlPgto > 0 && val > 0 && vlPgto !== val;
      if (encargoPossivel && vlPgto <= val * 1.4) {
        const encargoCalculado = vlPgto - val;
        if (encargoCalculado > 0) totalEncargos += encargoCalculado;
      }

      if (!borderoMap.has(bNum)) {
        borderoMap.set(bNum, { totalValue: 0, rate: 0, hasRate: false });
      }
      const bData = borderoMap.get(bNum);
      bData.totalValue += val;
      if (!bData.hasRate && hasRateVal) {
        bData.rate = rate;
        bData.hasRate = true;
      }

      if (val > 0) {
        sumFaceTotal += val;
        countTitulos += 1;
        
        let prazo = 0;
        if (emisKey && r[emisKey]) {
          const eDate = new Date(String(r[emisKey]).split("T")[0] + "T00:00:00");
          // Atualiza minDate e maxDate
          if (!minDate || eDate < minDate) minDate = eDate;
          if (!maxDate || eDate > maxDate) maxDate = eDate;

          if (vctoKey && r[vctoKey]) {
            const vDate = new Date(String(r[vctoKey]).split("T")[0] + "T00:00:00");
            const diffTime = vDate - eDate;
            if (diffTime > 0) prazo = Math.round(diffTime / (1000 * 60 * 60 * 24));
          }
        }
        sumPrazoWeighted += (prazo * val);
      }
    });

    let baseCalculoTaxa = 0;
    let sumTaxaWeighted = 0;

    borderoMap.forEach(b => {
      if (b.hasRate && b.totalValue > 0) {
        sumTaxaWeighted += (b.rate * b.totalValue);
        baseCalculoTaxa += b.totalValue;
      }
    });

    // Calcula os dias de operação
    let diasOperacao = 1; // Mínimo de 1 dia para evitar "em 0 dias"
    if (minDate && maxDate) {
      const diff = Math.round((maxDate - minDate) / (1000 * 60 * 60 * 24));
      diasOperacao = Math.max(1, diff);
    }

    return {
      riscoAtual,
      taxaMedia: baseCalculoTaxa > 0 ? (sumTaxaWeighted / baseCalculoTaxa) : 0,
      baseCalculo: baseCalculoTaxa,
      qtdBorderos: borderoMap.size,
      valorMedio: borderoMap.size > 0 ? sumFaceTotal / borderoMap.size : 0,
      prazoMedio: sumFaceTotal > 0 ? sumPrazoWeighted / sumFaceTotal : 0,
      desagioTotal: totalDesagio,
      encargosTotal: totalEncargos,
      diasOperacao
    };
  }, [rowsParaTabela]);

  useEffect(() => {
    if (session) {
      async function buscarRelacionamentos() {
        const { data } = await supabase.from("secInfo").select("Cliente, Sacado");
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
      if (clienteSelecionado) {
        query = query.eq("Cliente", clienteSelecionado);
      } else if (grupoSelecionado) {
        const grupo = GRUPOS_ECONOMICOS.find(g => g.label === grupoSelecionado);
        if (grupo) {
          // Filtra clientes cujo nome começa com algum dos prefixos do grupo
          // Supabase não tem startsWith múltiplo, então buscamos sem filtro e filtramos no client
          // Para eficiência, usamos ilike com or via rpc ou simplesmente filtramos no client
        }
      }
      if (sacadoSelecionado) query = query.eq("Sacado", sacadoSelecionado);
      query = query.order("id", { ascending: false }).limit(10000);
      const { data } = await query;
      if (data) {
        let filtered = data.filter(r => sacadoValido(r.Sacado) && cedenteValido(r.Cliente));
        if (grupoSelecionado && !clienteSelecionado) {
          const grupo = GRUPOS_ECONOMICOS.find(g => g.label === grupoSelecionado);
          if (grupo) {
            filtered = filtered.filter(r => grupo.prefixos.some(p => String(r.Cliente || "").trim().startsWith(p.trim())));
          }
        }
        setRows(filtered);
      }
      setLoading(false);
    }, 300);
    return () => clearTimeout(delayDebounceFn);
  }, [clienteSelecionado, sacadoSelecionado, grupoSelecionado, session?.user?.id]);

  const limparFiltroEntidades = () => {
    setClienteSelecionado(""); 
    setSacadoSelecionado(""); 
    setGrupoSelecionado("");
  };

  const limparFiltroData = () => {
    handleSetDateFilter({ type: inputType, start: '', end: '' }); 
  };

  const hasEntityFilter = !!(clienteSelecionado || sacadoSelecionado || grupoSelecionado);
  const hasDateFilter = !!(dateFilter.start || dateFilter.end);
  const hasAnyFilter = hasEntityFilter || hasDateFilter || viewMode !== 'all' || insightFilter || borderoFilter || dctoFilter;

  const getTabStyle = (isActive) => ({
    padding: "8px 16px", borderRadius: "6px", border: "1px solid", borderColor: isActive ? "#4f46e5" : "#d1d5db",
    background: isActive ? "#e0e7ff" : "#fff", color: isActive ? "#4f46e5" : "#4b5563",
    fontWeight: "600", fontSize: "13px", cursor: "pointer", transition: "all 0.2s"
  });

  const getQuickBtnStyle = (isActive) => ({
    padding: "6px 14px", borderRadius: "6px", border: "1px solid", borderColor: isActive ? "#4f46e5" : "#d1d5db",
    background: isActive ? "#e0e7ff" : "#fff", color: isActive ? "#4f46e5" : "#4b5563",
    fontWeight: "600", fontSize: "12px", cursor: "pointer", transition: "all 0.2s"
  });

return (
    // NOVO LAYOUT: Container Root flexível englobando todo o dashboard
    <div style={{ display: "flex", width: "100%", position: "relative", alignItems: "flex-start", minHeight: "100vh", marginLeft: (!isMobile && !isTablet && isSidebarOpen) ? "150px" : "0px", marginRight: (!isMobile && !isTablet && isSidebarOpen) ? "-150px" : "0px", paddingLeft: (isTablet && isSidebarOpen) ? "300px" : "0px", transition: "margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1), margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1), padding-left 0.3s cubic-bezier(0.4, 0, 0.2, 1)", boxSizing: "border-box" }}>
      <style>
        {`
          .table-row-liquidado { background: rgba(34, 197, 94, 0.08); }
          .table-row-liquidado:hover { background: rgba(34, 197, 94, 0.15); }
          .table-row-liquidadoAtraso { background: rgba(245, 158, 11, 0.08); }
          .table-row-liquidadoAtraso:hover { background: rgba(245, 158, 11, 0.15); }
          .table-row-atraso { background: rgba(239, 68, 68, 0.08); }
          .table-row-atraso:hover { background: rgba(239, 68, 68, 0.15); }
          .table-row-recompra { background: rgba(139, 92, 246, 0.08); }
          .table-row-recompra:hover { background: rgba(139, 92, 246, 0.15); }
          .table-row-aVencer { background: rgba(148, 163, 184, 0.05); }
          .table-row-aVencer:hover { background: rgba(148, 163, 184, 0.12); }
          .table-row-default { background: #fff; }
          .table-row-default:hover { background: #f9fafb; }
          .clickable-entity { cursor: pointer; font-weight: 600; color: #374151; transition: color 0.2s; }
          .clickable-entity:hover { color: #4f46e5; }
        `}
      </style>

      {/* OVERLAY MOBILE: Fecha o menu se clicado fora */}
      {isMobile && isSidebarOpen && (
        <div
          onClick={() => setIsSidebarOpen(false)}
          style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 9998 }}
        />
      )}

      {/* BOTÃO HAMBURGER FIXO À ESQUERDA (TIPO GEMINI) */}
      <button
        onClick={() => handleSidebarToggle(!isSidebarOpen, isMobile, isTablet)}
        title={isSidebarOpen ? "Fechar Menu" : "Abrir Menu"}
        style={{
          position: "fixed",
          top: "16px",
          left: "16px",
          zIndex: 10000,
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: "8px",
          padding: "8px",
          cursor: "pointer",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#374151",
          transition: "background 0.2s"
        }}
        onMouseOver={(e) => e.currentTarget.style.background = "#f3f4f6"}
        onMouseOut={(e) => e.currentTarget.style.background = "#fff"}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
      </button>

      {/* --- SIDEBAR LATERAL FIXA (FILTROS) --- */}
      <aside style={{
        position: "fixed",
        top: 0,
        left: isSidebarOpen ? 0 : "-300px",
        bottom: 0,
        width: "300px",
        background: "#fff",
        padding: "24px",
        paddingTop: "72px",
        boxShadow: "4px 0 15px rgba(0,0,0,0.05)",
        borderRight: "1px solid #e5e7eb",
        display: "flex",
        flexDirection: "column",
        gap: "24px",
        overflowY: "auto",
        transition: "left 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        zIndex: 9999,
        boxSizing: "border-box"
      }}>
        <h2 style={{ margin: 0, color: "#111827", fontSize: "18px", borderBottom: "2px solid #f3f4f6", paddingBottom: "12px" }}>Filtros de Análise</h2>

        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <label style={{ display: "block", marginBottom: 6, fontSize: "13px", fontWeight: "600", color: "#374151" }}>Cedente</label>
            <CustomDropdown value={clienteSelecionado} onChange={(v) => { setClienteSelecionado(v); if (v) setGrupoSelecionado(""); }} options={clientesDisponiveis} placeholder="Selecione o Cedente..." />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: 6, fontSize: "13px", fontWeight: "600", color: "#374151" }}>Grupo Econômico</label>
            <CustomDropdown
              value={grupoSelecionado}
              onChange={(v) => { setGrupoSelecionado(v); if (v) { setClienteSelecionado(""); setSacadoSelecionado(""); } }}
              options={GRUPOS_ECONOMICOS.map(g => g.label)}
              placeholder="Selecione o Grupo..."
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: 6, fontSize: "13px", fontWeight: "600", color: "#374151" }}>Sacado</label>
            <CustomDropdown value={sacadoSelecionado} onChange={setSacadoSelecionado} options={sacadosDisponiveis} placeholder="Selecione o Sacado..." />
          </div>
          <button onClick={limparFiltroEntidades} disabled={!hasEntityFilter} style={{ padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", background: (!hasEntityFilter) ? "#f9fafb" : "#fff", color: (!hasEntityFilter) ? "#9ca3af" : "#ef4444", fontWeight: "600", fontSize: "13px", cursor: (!hasEntityFilter) ? "not-allowed" : "pointer", transition: "all 0.2s" }}>
            Limpar Nomes
          </button>
        </div>

        <hr style={{ border: 0, borderTop: "1px dashed #d1d5db", margin: 0 }} />

        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <label style={{ display: "block", fontSize: "14px", fontWeight: "700", color: "#111827" }}>Período Base</label>
          
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <button onClick={() => applyQuickDate('mes_atual')} style={getQuickBtnStyle(activeQuickDate === 'mes_atual')}>Mês Atual</button>
            <button onClick={() => applyQuickDate('ult_30')} style={getQuickBtnStyle(activeQuickDate === 'ult_30')}>Últ. 30 Dias</button>
            <button onClick={() => applyQuickDate('ytd')} style={getQuickBtnStyle(activeQuickDate === 'ytd')}>YTD</button>
            <button onClick={() => applyQuickDate('ult_semestre')} style={getQuickBtnStyle(activeQuickDate === 'ult_semestre')}>Últ. Sem.</button>
            <button onClick={() => applyQuickDate('ult_ano')} style={{ ...getQuickBtnStyle(activeQuickDate === 'ult_ano'), gridColumn: "span 2" }}>Último Ano</button>
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 6, fontSize: "12px", fontWeight: "600", color: "#6b7280" }}>Referência de Data</label>
            <select 
              value={inputType} 
              onChange={e => {
                const newType = e.target.value;
                setInputType(newType);
                // Já aplica o filtro automaticamente com as datas que estiverem nos inputs
                handleSetDateFilter({ type: newType, start: inputDateStart, end: inputDateEnd }); 
                setBorderoFilter(null); 
                setDctoFilter(null);
              }} 
              style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #d1d5db", background: "#f9fafb", fontSize: "13px", color: "#111827", outline: "none" }}
            >
              <option value="emis">Data de Emissão</option>
              <option value="vcto">Data de Vencimento</option>
            </select>
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 6, fontSize: "12px", fontWeight: "600", color: "#6b7280" }}>Data Inicial</label>
            <input type="date" value={inputDateStart} onChange={e => setInputDateStart(e.target.value)} style={{ width: "100%", padding: "9px", borderRadius: "6px", border: "1px solid #d1d5db", background: "#fff", fontSize: "13px", color: "#111827", outline: "none", boxSizing: "border-box" }} />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 6, fontSize: "12px", fontWeight: "600", color: "#6b7280" }}>Data Final</label>
            <input type="date" value={inputDateEnd} onChange={e => setInputDateEnd(e.target.value)} style={{ width: "100%", padding: "9px", borderRadius: "6px", border: "1px solid #d1d5db", background: "#fff", fontSize: "13px", color: "#111827", outline: "none", boxSizing: "border-box" }} />
          </div>

          <div style={{ display: "flex", gap: "8px", flexDirection: "column", marginTop: "8px" }}>
            <button onClick={() => { handleSetDateFilter({ type: inputType, start: inputDateStart, end: inputDateEnd }); setBorderoFilter(null); setDctoFilter(null); }} style={{ padding: "10px", borderRadius: "8px", border: "none", background: "#4f46e5", color: "#fff", fontWeight: "600", fontSize: "13px", cursor: "pointer", transition: "all 0.2s" }}>Aplicar Intervalo</button>
            <button onClick={limparFiltroData} disabled={!hasDateFilter} style={{ padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", background: (!hasDateFilter) ? "#f9fafb" : "#fff", color: (!hasDateFilter) ? "#9ca3af" : "#ef4444", fontWeight: "600", fontSize: "13px", cursor: (!hasDateFilter) ? "not-allowed" : "pointer", transition: "all 0.2s" }}>Limpar Data</button>
          </div>
        </div>
      </aside>

        {/* --- ÁREA PRINCIPAL (CONTEÚDO E GRÁFICOS) --- */}
        <main style={{
          width: "100%",
          display: "flex",
          flexDirection: "column",
          paddingBottom: "24px"
        }}>
        
        {/* Container limpo, sem forçar minWidth quebrando o flex */}
          <div style={{
            width: "100%",
            maxWidth: "100%",
            margin: "0 auto", 
            display: "flex",
            flexDirection: "column",
            gap: "24px",
            boxSizing: "border-box"
        }}>
          {/* Top Bar de Controlo de View */}
          <div style={{ background: "#fff", padding: "16px 24px", borderRadius: "12px", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", flexWrap: "wrap", alignItems: "center", gap: "16px" }}>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
            <button
              onClick={() => {
                setViewMode('all');
                setInsightFilter(null);
                setBorderoFilter(null);
                setDctoFilter(null);
              }}
              style={getTabStyle(viewMode === 'all')}
            >
              Visão Geral
            </button>

            <button
              onClick={() => {
                setViewMode(prev => prev === 'finalized' ? 'all' : 'finalized');
                setInsightFilter(null);
                setBorderoFilter(null);
                setDctoFilter(null);
              }}
              style={getTabStyle(viewMode === 'finalized')}
            >
              Operações Já Finalizadas
            </button>

            <button
              onClick={() => {
                setViewMode(prev => prev === 'open' ? 'all' : 'open');
                setInsightFilter(null);
                setBorderoFilter(null);
                setDctoFilter(null);
              }}
              style={getTabStyle(viewMode === 'open')}
            >
              Mostrar Em Aberto
            </button>
              {/* Botão Olho — esconde/mostra valores monetários */}
              <button
                onClick={() => setHideValues(v => !v)}
                title={hideValues ? "Mostrar valores" : "Ocultar valores"}
                style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid #d1d5db", background: hideValues ? "#f3f4f6" : "#fff", color: hideValues ? "#4f46e5" : "#6b7280", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}
              >
                {hideValues ? (
                  /* Olho fechado */
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  /* Olho aberto */
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>

            {dateFilter && (dateFilter.start || dateFilter.end) && (
              <div style={{ fontSize: "13px", color: "#4f46e5", fontWeight: "600", textAlign: "right" }}>
                Filtro ativo: 
                {dateFilter.start ? ` de ${formatarData(dateFilter.start)}` : ''} 
                {dateFilter.end ? ` até ${formatarData(dateFilter.end)}` : ''}.
              </div>
            )}
          </div>

            {rowsFilteredByMode.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              {/* NOVO BANNER DE KPIs: 4 COLUNAS E DESÁGIO ADICIONADO */}
              {rowsParaTabela.length > 0 && (
                <div style={{
                  background: "#d1d5db", 
                  borderRadius: "12px",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(max(260px, calc((100% - 3 * 1px) / 4)), 1fr))",
                  gap: "1px",
                  boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)", 
                  border: "1px solid #d1d5db",
                  overflow: "hidden"
                }}>

                {/* INFO 0: Risco Atual */}
                <div style={{ background: "linear-gradient(180deg, #ffffff 0%, #ffffff 100%)", borderTop: "3px solid #16a34a", padding: "20px 16px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                    <div style={{ background: "rgba(22, 163, 74, 0.10)", padding: "6px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="16" height="16" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                        <path d="M12 1v22"></path>
                        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                      </svg>
                    </div>
                    <h3 style={{ margin: 0, fontSize: "11px", fontWeight: "700", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "normal" }}>
                      Risco Atual
                    </h3>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
                    <span style={{ fontSize: "28px", fontWeight: "700", color: "#111827", lineHeight: "1", letterSpacing: "-0.02em", wordBreak: "break-word" }}>
                      {fmtM(riscoAtual)}
                    </span>
                  </div>
                  <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "12px", fontWeight: "500", whiteSpace: "normal" }}>
                    Títulos em aberto na seleção
                  </div>
                </div>

                {/* INFO 1: Taxa Média */}
                <div style={{ background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)", borderTop: "3px solid #4f46e5", padding: "20px 16px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                    <div style={{ background: "rgba(79, 70, 229, 0.1)", padding: "6px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="16" height="16" fill="none" stroke="#4f46e5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></svg>
                    </div>
                    <h3 style={{ margin: 0, fontSize: "11px", fontWeight: "700", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "normal" }}>Taxa Média Ponderada</h3>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
                    <span style={{ fontSize: "28px", fontWeight: "700", color: "#111827", lineHeight: "1", letterSpacing: "-0.02em", wordBreak: "break-word" }}>{kpiData.taxaMedia.toFixed(2).replace('.', ',')}% a.m.</span>
                  </div>
                  <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "12px", fontWeight: "500", whiteSpace: "normal" }}>
                    Base: <span style={{color: "#374151", fontWeight: "600"}}>{fmtM(kpiData.baseCalculo)}</span>
                  </div>
                </div>

                {/* INFO 2: Ticket Médio */}
                <div style={{ background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)", borderTop: "3px solid #0ea5e9", padding: "20px 16px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                    <div style={{ background: "rgba(14, 165, 233, 0.1)", padding: "6px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="16" height="16" fill="none" stroke="#0ea5e9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"></rect><circle cx="12" cy="12" r="2"></circle><path d="M6 12h.01M18 12h.01"></path></svg>
                    </div>
                    <h3 style={{ margin: 0, fontSize: "11px", fontWeight: "700", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "normal" }}>Ticket Médio</h3>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
                    <span style={{ fontSize: "28px", fontWeight: "700", color: "#111827", lineHeight: "1", letterSpacing: "-0.02em", wordBreak: "break-word" }}>{fmtM(kpiData.valorMedio)}</span>
                  </div>
                <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "12px", fontWeight: "500", whiteSpace: "normal" }}>
                  Borderôs analisados: <span style={{ color: "#374151", fontWeight: "600" }}>{kpiData.qtdBorderos}</span>
                </div>
                </div>

                {/* INFO 3: Prazo Médio */}
                <div style={{ background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)", borderTop: "3px solid #10b981", padding: "20px 16px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                    <div style={{ background: "rgba(16, 185, 129, 0.1)", padding: "6px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="16" height="16" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                    </div>
                    <h3 style={{ margin: 0, fontSize: "11px", fontWeight: "700", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "normal" }}>Prazo Médio</h3>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                    <span style={{ fontSize: "28px", fontWeight: "700", color: "#111827", lineHeight: "1", letterSpacing: "-0.02em", wordBreak: "break-word" }}>{kpiData.prazoMedio.toFixed(0)}</span>
                    <span style={{ fontSize: "14px", color: "#6b7280", fontWeight: "600" }}>dias</span>
                  </div>
                  <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "12px", fontWeight: "500", whiteSpace: "normal" }}>
                    Ponderado pelo valor de face
                  </div>
                </div>

              {/* INFO 5: Deságio Total */}
              <div style={{ background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)", borderTop: "3px solid #f59e0b", padding: "20px 16px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                  <div style={{ background: "rgba(245, 158, 11, 0.1)", padding: "6px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="16" height="16" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
                      <line x1="7" y1="7" x2="7.01" y2="7"></line>
                    </svg>
                  </div>
                  <h3 style={{ margin: 0, fontSize: "11px", fontWeight: "700", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "normal" }}>
                    Deságio Total
                  </h3>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
                  <span style={{ fontSize: "28px", fontWeight: "700", color: "#111827", lineHeight: "1", letterSpacing: "-0.02em", wordBreak: "break-word" }}>
                    {fmtM(kpiData.desagioTotal)}
                  </span>
                </div>
                <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "12px", fontWeight: "500", whiteSpace: "normal" }}>
                  Apurado em <span style={{color: "#374151", fontWeight: "600"}}>
                    {kpiData.diasOperacao > 90
                      ? (kpiData.diasOperacao / 30).toFixed(1).replace('.', ',')
                      : kpiData.diasOperacao}
                  </span> {kpiData.diasOperacao > 90 ? "meses" : "dias"}
                </div>
              </div>

              {/* INFO 6: Encargos Totais */}
              <div style={{ background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)", borderTop: "3px solid #ea580c", padding: "20px 16px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                  <div style={{ background: "rgba(234, 88, 12, 0.1)", padding: "6px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="16" height="16" fill="none" stroke="#ea580c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                      <path d="M12 1v22"></path>
                      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                    </svg>
                  </div>
                  <h3 style={{ margin: 0, fontSize: "11px", fontWeight: "700", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "normal" }}>
                    Encargos Totais
                  </h3>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
                  <span style={{ fontSize: "28px", fontWeight: "700", color: "#111827", lineHeight: "1", letterSpacing: "-0.02em", wordBreak: "break-word" }}>
                    {fmtM(kpiData.encargosTotal)}
                  </span>
                </div>
                
                <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "12px", fontWeight: "500", whiteSpace: "normal" }}>
                  Apurado em <span style={{color: "#374151", fontWeight: "600"}}>
                    {kpiData.diasOperacao > 90
                      ? (kpiData.diasOperacao / 30).toFixed(1).replace('.', ',')
                      : kpiData.diasOperacao}
                  </span> {kpiData.diasOperacao > 90 ? "meses" : "dias"}
                </div>
              </div>

              </div>
              )}
              
              <DashboardInsights processedRows={rowsFilteredByDate} insightFilter={insightFilter} setInsightFilter={setInsightFilter} setBorderoFilter={setBorderoFilter} setDctoFilter={setDctoFilter} hideValues={hideValues} />
              
              {(clienteSelecionado || grupoSelecionado) && (
                <SacadoConcentrationCard
                  rows={rowsParaTabela}
                  clienteSelecionado={clienteSelecionado}
                  grupoSelecionado={grupoSelecionado}
                  sacadoSelecionado={sacadoSelecionado}
                  setSacadoSelecionado={setSacadoSelecionado}
                  hideValues={hideValues}
                />
              )}
              
              <EvolutionCharts rows={evolutionRows} dateFilter={dateFilter} setDateFilter={handleSetDateFilter} setBorderoFilter={setBorderoFilter} setDctoFilter={setDctoFilter} hideValues={hideValues} />
            </div>
          )}

          <div style={{ position: "relative", minHeight: loading ? "150px" : "auto" }}>
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
                <p style={{ margin: "8px 0 0 0", fontSize: "13px" }}>Selecione um <strong>Cedente</strong>, <strong>Sacado</strong> ou filtre na barra lateral para carregar os registos detalhados.</p>
              </div>
            ) : (
              (!loading || rowsParaTabela.length > 0) && (
                <SimpleTable rows={rowsParaTabela} clienteSelecionado={clienteSelecionado} sacadoSelecionado={sacadoSelecionado} dateFilter={dateFilter} borderoFilter={borderoFilter} setBorderoFilter={setBorderoFilter} dctoFilter={dctoFilter} setDctoFilter={setDctoFilter} setDateFilter={handleSetDateFilter} setInsightFilter={setInsightFilter} setClienteSelecionado={setClienteSelecionado} setSacadoSelecionado={setSacadoSelecionado} hideValues={hideValues} />
              )
            )}
          </div>
        </div>
      </main>
    </div>
  );
}