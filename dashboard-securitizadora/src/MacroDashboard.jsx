import { useEffect, useMemo, useState } from "react";
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

// --- LISTAS E VALIDAÇÕES ---
const CEDENTES_IGNORADOS = [
  "12 -",
  "23 -", 
];

function cedenteValido(cedente) {
  if (!cedente) return false;
  return !CEDENTES_IGNORADOS.some(ignorado => String(cedente).trim().startsWith(ignorado));
}

function sacadoValido(sacado) {
  if (!sacado) return false;
  const s = String(sacado).trim();
  return !(s === "0" || s.startsWith("0 -") || s.startsWith("0-"));
}

// --- COMPONENTE DA TABELA DETALHADA DO MACRO ---
function MacroDetailedTable({ rows, focus, setFocus, setSelectedSlice }) {
  const [sortConfig, setSortConfig] = useState(null);

  const colunasOcultas = ["id", "created_at", "Cód.Red", "UF", "Banco", "Rec.", "Estado", "_status"];

  const columns = useMemo(() => {
    const set = new Set();
    for (const r of rows) Object.keys(r).forEach((k) => set.add(k));
    
    let cols = Array.from(set).filter(c => !colunasOcultas.includes(c));

    if (focus === 'cedente') cols = cols.filter(c => c !== "Cliente");
    if (focus === 'sacado') cols = cols.filter(c => c !== "Sacado");

    if (focus === 'cedente' && cols.includes("Sacado")) {
      cols = ["Sacado", ...cols.filter(c => c !== "Sacado")];
    } else if (focus === 'sacado' && cols.includes("Cliente")) {
      cols = ["Cliente", ...cols.filter(c => c !== "Cliente")];
    }

    return cols;
  }, [rows, focus]);

  const activeSort = useMemo(() => {
    if (sortConfig) return sortConfig;
    if (rows.length === 0) return null;
    const vctoKey = Object.keys(rows[0]).find(k => k.toLowerCase().includes('vcto') && !k.toLowerCase().includes('vl'));
    if (vctoKey) return { key: vctoKey, direction: 'asc' };
    return null;
  }, [sortConfig, rows]);

  const sortedRows = useMemo(() => {
    let sortableItems = [...rows];
    if (activeSort !== null) {
      sortableItems.sort((a, b) => {
        let aValue = a[activeSort.key] || "";
        let bValue = b[activeSort.key] || "";

        const keyLower = activeSort.key.toLowerCase();
        const isCurrency = keyLower === "entrada" || keyLower === "vl pgto" || keyLower.includes("valor") || keyLower === "desagio" || keyLower === "deságio";
        const isRate = keyLower.includes("tx") || keyLower.includes("taxa");
        const isDateColumn = !isCurrency && !isRate && (keyLower.includes("emis") || keyLower.includes("vcto") || keyLower.includes("pgto") || keyLower.includes("data"));

        if (isDateColumn) {
          const dateA = aValue ? new Date(aValue).getTime() : 0;
          const dateB = bValue ? new Date(bValue).getTime() : 0;
          return activeSort.direction === 'asc' ? dateA - dateB : dateB - dateA;
        } else if (isCurrency || isRate) {
          let numA = Number(String(aValue).replace('%', '').replace(',', '.')) || 0;
          let numB = Number(String(bValue).replace('%', '').replace(',', '.')) || 0;
          return activeSort.direction === 'asc' ? numA - numB : numB - numA;
        } else {
          const strA = String(aValue).toLowerCase();
          const strB = String(bValue).toLowerCase();
          if (strA < strB) return activeSort.direction === 'asc' ? -1 : 1;
          if (strA > strB) return activeSort.direction === 'asc' ? 1 : -1;
          return 0;
        }
      });
    }
    return sortableItems;
  }, [rows, activeSort]);

  const requestSort = (key) => {
    let direction = 'asc';
    if (activeSort && activeSort.key === key && activeSort.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  function getRowColors(status) {
    if (status === 'atraso') return { bg: 'rgba(239, 68, 68, 0.08)', hover: 'rgba(239, 68, 68, 0.15)' };
    if (status === 'aVencer') return { bg: 'rgba(148, 163, 184, 0.05)', hover: 'rgba(148, 163, 184, 0.12)' };
    return { bg: '#fff', hover: '#f9fafb' };
  }

  return (
    <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "14px", whiteSpace: "nowrap", textAlign: "left" }}>
        <thead>
          <tr style={{ background: "#f9fafb", color: "#374151" }}>
            {columns.map((c) => {
              let labelColuna = c === "Entrada" ? "Valor de Face" : c === "Cliente" ? "Cedente" : c.toLowerCase() === "vcto" ? "Dt.Vcto" : c;
              const isSorted = activeSort?.key === c;
              return (
                <th key={c} onClick={() => requestSort(c)} style={{ padding: "12px 16px", borderBottom: "2px solid #e5e7eb", cursor: "pointer", fontWeight: "600", userSelect: "none" }}>
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
              <tr key={r.id || idx} style={{ background: bg, borderBottom: "1px solid #e5e7eb", transition: "background 0.2s" }} onMouseOver={(e) => e.currentTarget.style.background = hover} onMouseOut={(e) => e.currentTarget.style.background = bg}>
                {columns.map((c) => {
                  let valor = r[c];
                  const cLower = c.toLowerCase();
                  const isCurrency = cLower === "entrada" || cLower === "vl pgto" || cLower.includes("valor") || cLower === "desagio" || cLower === "deságio";
                  const isRate = cLower.includes("tx") || cLower.includes("taxa");
                  const isDateColumn = !isCurrency && !isRate && (cLower.includes("emis") || cLower.includes("vcto") || cLower.includes("pgto") || cLower.includes("data"));
                  
                  if (isDateColumn) valor = formatarData(valor);
                  else if (isCurrency) valor = formatarMoeda(valor);
                  else if (isRate) {
                    const valNum = Number(String(valor).replace('%', '').replace(',', '.'));
                    valor = !isNaN(valNum) && valor ? `${valNum.toFixed(2).replace('.', ',')}%` : escapeText(valor);
                  }

                  // Cross-Navigation
                  if (c === "Cliente" && focus === 'sacado') {
                    return (
                      <td key={c} style={{ padding: "12px 16px", color: "#374151" }}>
                        <span onClick={() => { setFocus('cedente'); setSelectedSlice(r[c]); }} style={{ cursor: "pointer", fontWeight: "600", color: "#4f46e5", textDecoration: "underline", textDecorationColor: "transparent", transition: "all 0.2s" }} onMouseOver={(e) => e.currentTarget.style.textDecorationColor = "#4f46e5"} onMouseOut={(e) => e.currentTarget.style.textDecorationColor = "transparent"}>
                          {escapeText(valor)}
                        </span>
                      </td>
                    );
                  }
                  if (c === "Sacado" && focus === 'cedente') {
                    return (
                      <td key={c} style={{ padding: "12px 16px", color: "#374151" }}>
                        <span onClick={() => { setFocus('sacado'); setSelectedSlice(r[c]); }} style={{ cursor: "pointer", fontWeight: "600", color: "#0ea5e9", textDecoration: "underline", textDecorationColor: "transparent", transition: "all 0.2s" }} onMouseOver={(e) => e.currentTarget.style.textDecorationColor = "#0ea5e9"} onMouseOut={(e) => e.currentTarget.style.textDecorationColor = "transparent"}>
                          {escapeText(valor)}
                        </span>
                      </td>
                    );
                  }

                  return <td key={c} style={{ padding: "12px 16px", color: "#374151" }}>{escapeText(valor)}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


// --- DASHBOARD MACRO PRINCIPAL ---
export default function MacroDashboard() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [focus, setFocus] = useState('cedente'); 
  
  const [hoveredSlice, setHoveredSlice] = useState(null);
  const [selectedSlice, setSelectedSlice] = useState(null); 
  const [tooltip, setTooltip] = useState({ show: false, x: 0, y: 0, label: '', value: 0, percent: 0 });

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      const { data, error } = await supabase.from("secInfo").select("*").order("id", { ascending: false }).limit(10000);
      if (data) {
        const dadosLimpos = data.filter(r => sacadoValido(r.Sacado) && cedenteValido(r.Cliente));
        setRows(dadosLimpos);
      }
      if (error) console.error("Erro ao buscar dados Macro:", error);
      setLoading(false);
    }
    fetchData();
  }, []);

  // 1. Processa todos os registos (Em Aberto e Variação Mensal Rolling Window)
  const { openRows, stats } = useMemo(() => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const sixtyDaysAgo = new Date(today);
    sixtyDaysAgo.setDate(today.getDate() - 60);
    sixtyDaysAgo.setHours(0, 0, 0, 0);
    
    const abertos = [];
    const grouped = {};
    const monthlyVolume = {};
    let totalVal = 0;

    rows.forEach(r => {
      let status = 'invalido';
      const vctoKey = Object.keys(r).find(k => k.toLowerCase() === 'vcto' || (k.toLowerCase().includes('vcto') && !k.toLowerCase().includes('vl')));
      const pgtoKey = Object.keys(r).find(k => k.toLowerCase() === 'pgto' || (k.toLowerCase().includes('pgto') && !k.toLowerCase().includes('vl')));
      const statusKey = Object.keys(r).find(k => k.toLowerCase() === 'status' || k.toLowerCase() === 'estado');
      const emisKey = Object.keys(r).find(k => k.toLowerCase().includes('emis'));
      const valKey = Object.keys(r).find(k => k.toLowerCase() === 'entrada' || (k.toLowerCase().includes('valor') && !k.toLowerCase().includes('pgto')));
      
      const vctoVal = vctoKey ? r[vctoKey] : null;
      const pgtoVal = pgtoKey ? r[pgtoKey] : null;
      const statusVal = statusKey ? String(r[statusKey]).trim().toUpperCase() : "";
      const val = valKey ? (Number(r[valKey]) || 0) : 0;

      const entity = focus === 'cedente' ? r.Cliente : r.Sacado;
      const eName = entity ? String(entity).trim() : null;

      if (eName && emisKey && r[emisKey]) {
        const emisDate = new Date(String(r[emisKey]).split("T")[0] + "T00:00:00");
        
        if (emisDate >= thirtyDaysAgo && emisDate <= today) {
          if (!monthlyVolume[eName]) monthlyVolume[eName] = { lm: 0, plm: 0 };
          monthlyVolume[eName].lm += val;
        } else if (emisDate >= sixtyDaysAgo && emisDate < thirtyDaysAgo) {
          if (!monthlyVolume[eName]) monthlyVolume[eName] = { lm: 0, plm: 0 };
          monthlyVolume[eName].plm += val;
        }
      }

      if (statusVal === "REC" || statusVal.includes("REC")) {
        status = 'recompra';
      } else if (vctoVal) {
        const effectiveVcto = new Date(String(vctoVal).split("T")[0] + "T00:00:00");
        if (effectiveVcto.getDay() === 6) effectiveVcto.setDate(effectiveVcto.getDate() + 2);
        else if (effectiveVcto.getDay() === 0) effectiveVcto.setDate(effectiveVcto.getDate() + 1);

        if (pgtoVal && String(pgtoVal).trim() !== "") {
          const pgtoDate = new Date(String(pgtoVal).split("T")[0] + "T00:00:00");
          if (pgtoDate <= effectiveVcto) status = 'liquidado';
          else status = 'liquidadoAtraso';
        } else {
          if (effectiveVcto < today) status = 'atraso';
          else status = 'aVencer';
        }
      }

      if (status === 'aVencer' || status === 'atraso') {
        const rComStatus = { ...r, _status: status };
        abertos.push(rComStatus);

        if (eName) {
          if (!grouped[eName]) grouped[eName] = { val: 0, count: 0 };
          grouped[eName].val += val;
          grouped[eName].count += 1;
          totalVal += val;
        }
      }
    });

    const sorted = Object.keys(grouped).map(k => {
      const vol = monthlyVolume[k] || { lm: 0, plm: 0 };
      let varPct = 0;
      let hasVar = false;

      if (vol.plm > 0) {
        varPct = ((vol.lm - vol.plm) / vol.plm) * 100;
        hasVar = true;
      } else if (vol.lm > 0) {
        varPct = 100; 
        hasVar = true;
      }

      return {
        name: k,
        val: grouped[k].val,
        count: grouped[k].count,
        percent: totalVal > 0 ? grouped[k].val / totalVal : 0,
        varPct,
        hasVar
      };
    }).sort((a, b) => b.val - a.val).map((item, idx) => ({ ...item, rank: idx + 1 }));

    const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#0ea5e9', '#f97316', '#6366f1', '#9ca3af'];
    const top9 = sorted.slice(0, 9).map((item, idx) => ({ ...item, color: colors[idx] }));
    const rest = sorted.slice(9);
    
    if (rest.length > 0) {
      const restVal = rest.reduce((acc, curr) => acc + curr.val, 0);
      const restCount = rest.reduce((acc, curr) => acc + curr.count, 0);
      top9.push({
        name: `Restante (${rest.length} outros)`,
        val: restVal,
        count: restCount,
        percent: totalVal > 0 ? restVal / totalVal : 0,
        color: colors[9] 
      });
    }

    return { openRows: abertos, stats: { totalVal, sorted, pieData: top9 } };
  }, [rows, focus]);

  // 2. Extrai os detalhes da entidade selecionada
  const detailedRows = useMemo(() => {
    if (!selectedSlice || selectedSlice.startsWith('Restante')) return null;
    return openRows.filter(r => {
      const entity = focus === 'cedente' ? r.Cliente : r.Sacado;
      return String(entity).trim() === selectedSlice;
    });
  }, [openRows, selectedSlice, focus]);

  // 3. Calcula os KPIs com base na visualização atual (Global ou Específica)
  const kpiData = useMemo(() => {
    const kpiRows = detailedRows || openRows; 
    
    if (!kpiRows || kpiRows.length === 0) return { taxaMedia: 0, baseCalculo: 0, valorMedio: 0, prazoMedio: 0 };

    const borderoMap = new Map();
    let sumFaceTotal = 0;
    let sumPrazoWeighted = 0;
    let countTitulos = 0;

    kpiRows.forEach((r, idx) => {
      const borderoKey = Object.keys(r).find(k => k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes("border"));
      const valKey = Object.keys(r).find(k => k.toLowerCase() === 'entrada' || (k.toLowerCase().includes('valor') && !k.toLowerCase().includes('pgto')));
      const rateKey = Object.keys(r).find(k => k.toLowerCase() === 'tx.efet' || k.toLowerCase().includes('tx.efet') || k.toLowerCase().includes('tx efet'));

      const bNum = (borderoKey && r[borderoKey]) ? String(r[borderoKey]).trim() : `avulso_${idx}`; 
      const val = valKey ? (Number(r[valKey]) || 0) : 0;
      
      const rawRate = rateKey ? r[rateKey] : null;
      const hasRateVal = rawRate !== null && rawRate !== undefined && String(rawRate).trim() !== "";
      const rate = hasRateVal ? (Number(String(rawRate).replace('%', '').replace(',', '.')) || 0) : 0;

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
        
        const emisKey = Object.keys(r).find(k => k.toLowerCase().includes('emis'));
        const vctoKey = Object.keys(r).find(k => k.toLowerCase() === 'vcto' || (k.toLowerCase().includes('vcto') && !k.toLowerCase().includes('vl')));
        
        let prazo = 0;
        if (emisKey && r[emisKey] && vctoKey && r[vctoKey]) {
          const eDate = new Date(String(r[emisKey]).split("T")[0] + "T00:00:00");
          const vDate = new Date(String(r[vctoKey]).split("T")[0] + "T00:00:00");
          const diffTime = vDate - eDate;
          if (diffTime > 0) prazo = Math.round(diffTime / (1000 * 60 * 60 * 24));
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

    return {
      taxaMedia: baseCalculoTaxa > 0 ? (sumTaxaWeighted / baseCalculoTaxa) : 0,
      baseCalculo: baseCalculoTaxa,
      valorMedio: countTitulos > 0 ? sumFaceTotal / countTitulos : 0,
      prazoMedio: sumFaceTotal > 0 ? sumPrazoWeighted / sumFaceTotal : 0
    };
  }, [detailedRows, openRows]);


  const tableData = useMemo(() => {
    if (!selectedSlice) return stats.sorted;
    if (selectedSlice.startsWith('Restante')) return stats.sorted.slice(9);
    return stats.sorted.filter(item => item.name === selectedSlice);
  }, [stats.sorted, selectedSlice]);

  const handleMouseMove = (e, slice) => {
    setTooltip({ show: true, x: e.clientX, y: e.clientY, label: slice.name, value: slice.val, percent: slice.percent });
    setHoveredSlice(slice.name);
  };

  const handleSliceClick = (sliceName) => {
    setSelectedSlice(prev => prev === sliceName ? null : sliceName);
  };

  let cumulativePercent = 0;

  const getTabStyle = (isActive) => ({
    padding: "10px 20px", borderRadius: "8px", border: "2px solid", borderColor: isActive ? "#4f46e5" : "#e5e7eb",
    background: isActive ? "#eff6ff" : "#fff", color: isActive ? "#4f46e5" : "#6b7280",
    fontWeight: "700", fontSize: "14px", cursor: "pointer", transition: "all 0.2s"
  });

  if (loading) {
    return <div style={{ padding: "60px", textAlign: "center", color: "#4f46e5", fontWeight: "600", background: "#fff", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>Carregando dados Macro...</div>;
  }

  return (
    <div style={{ background: "#fff", padding: "32px", borderRadius: "12px", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)" }}>
      
      {/* Cabeçalho Macro */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h2 style={{ margin: "0 0 8px 0", color: "#111827", fontSize: "22px" }}>Visão Macroscópica de Risco</h2>
          <p style={{ margin: 0, color: "#6b7280", fontSize: "15px" }}>Concentração de Capital em títulos <strong>Em Aberto</strong> (A Vencer e Em Atraso).</p>
        </div>
        <div style={{ display: "flex", gap: "12px" }}>
          <button onClick={() => { setFocus('cedente'); setSelectedSlice(null); }} style={getTabStyle(focus === 'cedente')}>Concentração Cedente</button>
          <button onClick={() => { setFocus('sacado'); setSelectedSlice(null); }} style={getTabStyle(focus === 'sacado')}>Concentração Sacado</button>
        </div>
      </div>

      {stats.totalVal === 0 ? (
        <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af", background: "#f9fafb", borderRadius: "8px", border: "1px dashed #d1d5db" }}>
          Nenhum título em aberto para análise no momento.
        </div>
      ) : (
        <>
          {/* Gráfico de Pizza Top 9 + Restante */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "40px", alignItems: "center", padding: "32px", background: "#f9fafb", borderRadius: "12px", marginBottom: "32px", border: "1px solid #e5e7eb" }}>
            <div style={{ width: "260px", height: "260px", position: "relative" }}>
              <svg viewBox="-1.1 -1.1 2.2 2.2" style={{ transform: 'rotate(-90deg)', overflow: 'visible', width: '100%', height: '100%', filter: 'drop-shadow(0px 4px 6px rgba(0,0,0,0.15))' }} onMouseLeave={() => {setTooltip({ show: false }); setHoveredSlice(null);}}>
                {stats.pieData.map(slice => {
                  if (slice.percent === 0) return null;
                  
                  const isDimmed = selectedSlice && selectedSlice !== slice.name;
                  const sliceOpacity = isDimmed ? 0.25 : 1;

                  if (slice.percent === 1) {
                    return <circle key={slice.name} cx="0" cy="0" r="1" fill={slice.color} 
                      onMouseMove={(e) => handleMouseMove(e, slice)} 
                      onClick={() => handleSliceClick(slice.name)}
                      style={{ transform: hoveredSlice === slice.name ? 'scale(1.05)' : 'scale(1)', transformOrigin: '0 0', opacity: sliceOpacity, transition: 'all 0.2s', cursor: 'pointer' }} 
                    />;
                  }

                  const startX = Math.cos(2 * Math.PI * cumulativePercent);
                  const startY = Math.sin(2 * Math.PI * cumulativePercent);
                  cumulativePercent += slice.percent;
                  const endX = Math.cos(2 * Math.PI * cumulativePercent);
                  const endY = Math.sin(2 * Math.PI * cumulativePercent);
                  const largeArcFlag = slice.percent > 0.5 ? 1 : 0;
                  const pathData = `M 0 0 L ${startX} ${startY} A 1 1 0 ${largeArcFlag} 1 ${endX} ${endY} Z`;

                  return (
                    <path key={slice.name} d={pathData} fill={slice.color} 
                      onMouseMove={(e) => handleMouseMove(e, slice)}
                      onClick={() => handleSliceClick(slice.name)}
                      style={{ transform: hoveredSlice === slice.name ? 'scale(1.05)' : 'scale(1)', transformOrigin: '0 0', opacity: sliceOpacity, transition: 'all 0.2s', cursor: 'pointer' }}
                    />
                  );
                })}
              </svg>
            </div>
            
            {/* Legenda Lateral */}
            <div style={{ flex: 1, minWidth: "280px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
              {stats.pieData.map(slice => {
                const isDimmed = selectedSlice && selectedSlice !== slice.name;
                return (
                  <div 
                    key={slice.name} 
                    onClick={() => handleSliceClick(slice.name)}
                    onMouseEnter={() => setHoveredSlice(slice.name)}
                    onMouseLeave={() => setHoveredSlice(null)}
                    style={{ 
                      display: "flex", alignItems: "center", gap: "12px", 
                      opacity: isDimmed ? 0.3 : 1, 
                      transition: "all 0.2s",
                      cursor: "pointer",
                      background: selectedSlice === slice.name ? "#eff6ff" : "transparent",
                      padding: "6px 8px",
                      borderRadius: "8px",
                      marginLeft: "-8px"
                    }}
                  >
                    <div style={{ width: "16px", height: "16px", borderRadius: "4px", background: slice.color, flexShrink: 0 }} />
                    <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
                      <span style={{ fontSize: "14px", fontWeight: "600", color: "#374151", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={slice.name}>{slice.name}</span>
                      <span style={{ fontSize: "13px", color: "#6b7280" }}>{formatarMoeda(slice.val)} • <strong>{(slice.percent * 100).toFixed(1)}%</strong></span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* BANNER DE KPIs INTELIGENTE - CORPORATIVO ELEVADO COM LEVE DESTAQUE */}
          {kpiData.baseCalculo > 0 && (
            <div style={{
              background: "#d1d5db", // Fundo cinza cria a borda do grid internamente
              borderRadius: "12px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "1px",
              boxShadow: "0 14px 28px -6px rgba(0, 0, 0, 0.12), 0 4px 10px -4px rgba(0, 0, 0, 0.08)", // Sombreado elevado
              marginBottom: "36px",
              border: "1px solid #d1d5db",
              overflow: "hidden"
            }}>
              
              {/* BLOCO 1: Taxa Média */}
              <div style={{ background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)", borderTop: "3px solid #4f46e5", padding: "24px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                  <div style={{ background: "rgba(79, 70, 229, 0.1)", padding: "6px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="18" height="18" fill="none" stroke="#4f46e5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                      <path d="M23 6l-9.5 9.5-5-5L1 18"/>
                      <path d="M17 6h6v6"/>
                    </svg>
                  </div>
                  <h3 style={{ margin: 0, fontSize: "12px", fontWeight: "700", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>Taxa Média Ponderada</h3>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
                  <span style={{ fontSize: "36px", fontWeight: "700", color: "#111827", lineHeight: "1", letterSpacing: "-0.02em" }}>{kpiData.taxaMedia.toFixed(2).replace('.', ',')}%</span>
                </div>
                <div style={{ fontSize: "13px", color: "#6b7280", marginTop: "12px", fontWeight: "500" }}>
                  Base: <span style={{color: "#374151", fontWeight: "600"}}>{formatarMoeda(kpiData.baseCalculo)}</span> {selectedSlice && <span style={{color: "#4f46e5", background: "#e0e7ff", padding: "2px 6px", borderRadius: "4px", marginLeft: "4px", fontSize: "11px", fontWeight: "700"}}>FILTRO ATIVO</span>}
                </div>
              </div>

              {/* BLOCO 2: Ticket Médio */}
              <div style={{ background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)", borderTop: "3px solid #0ea5e9", padding: "24px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                  <div style={{ background: "rgba(14, 165, 233, 0.1)", padding: "6px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="18" height="18" fill="none" stroke="#0ea5e9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                      <rect x="2" y="6" width="20" height="12" rx="2"></rect>
                      <circle cx="12" cy="12" r="2"></circle>
                      <path d="M6 12h.01M18 12h.01"></path>
                    </svg>
                  </div>
                  <h3 style={{ margin: 0, fontSize: "12px", fontWeight: "700", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>Ticket Médio</h3>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
                  <span style={{ fontSize: "36px", fontWeight: "700", color: "#111827", lineHeight: "1", letterSpacing: "-0.02em" }}>{formatarMoeda(kpiData.valorMedio)}</span>
                </div>
                <div style={{ fontSize: "13px", color: "#6b7280", marginTop: "12px", fontWeight: "500" }}>
                  Média por título na visualização
                </div>
              </div>

              {/* BLOCO 3: Prazo Médio */}
              <div style={{ background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)", borderTop: "3px solid #10b981", padding: "24px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                  <div style={{ background: "rgba(16, 185, 129, 0.1)", padding: "6px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="18" height="18" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10"></circle>
                      <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                  </div>
                  <h3 style={{ margin: 0, fontSize: "12px", fontWeight: "700", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>Prazo Médio</h3>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                  <span style={{ fontSize: "36px", fontWeight: "700", color: "#111827", lineHeight: "1", letterSpacing: "-0.02em" }}>{kpiData.prazoMedio.toFixed(0)}</span>
                  <span style={{ fontSize: "16px", color: "#6b7280", fontWeight: "600" }}>dias</span>
                </div>
                <div style={{ fontSize: "13px", color: "#6b7280", marginTop: "12px", fontWeight: "500" }}>
                  Ponderado pelo valor de face
                </div>
              </div>

            </div>
          )}

          {/* Troca Dinâmica de Tabelas */}
          {detailedRows ? (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <div>
                  <h3 style={{ margin: "0 0 4px 0", color: "#111827", fontSize: "18px" }}>
                    Títulos em Aberto de: <span style={{ color: "#4f46e5" }}>{selectedSlice}</span>
                  </h3>
                  <div style={{ fontSize: "13px", color: "#6b7280" }}>
                    <strong>{detailedRows.length}</strong> registo(s) encontrado(s) totalizando <strong>{formatarMoeda(detailedRows.reduce((acc, row) => { const vk = Object.keys(row).find(k => k.toLowerCase() === 'entrada' || k.toLowerCase().includes('valor')); return acc + (vk ? Number(row[vk]) || 0 : 0) }, 0))}</strong>
                  </div>
                </div>
                <button onClick={() => setSelectedSlice(null)} style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: "600", color: "#374151", transition: "all 0.2s" }} onMouseOver={(e) => e.currentTarget.style.background = "#f9fafb"} onMouseOut={(e) => e.currentTarget.style.background = "#fff"}>
                  Voltar ao Ranking
                </button>
              </div>
              <MacroDetailedTable rows={detailedRows} focus={focus} setFocus={setFocus} setSelectedSlice={setSelectedSlice} />
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <h3 style={{ margin: 0, color: "#111827", fontSize: "18px" }}>
                  Ranking Geral ({focus === 'cedente' ? 'Cedentes' : 'Sacados'})
                </h3>
                {selectedSlice && (
                  <button onClick={() => setSelectedSlice(null)} style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontSize: "12px", fontWeight: "600", color: "#ef4444" }}>
                    Limpar Filtro "Restante"
                  </button>
                )}
              </div>

              <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "14px", textAlign: "left", whiteSpace: "nowrap" }}>
                  <thead>
                    <tr style={{ background: "#f9fafb", color: "#374151" }}>
                      <th style={{ padding: "14px 16px", borderBottom: "2px solid #e5e7eb" }}>Rank Global</th>
                      <th style={{ padding: "14px 16px", borderBottom: "2px solid #e5e7eb" }}>Nome</th>
                      <th style={{ padding: "14px 16px", borderBottom: "2px solid #e5e7eb" }}>Var. Vol. (Últ. 30d)</th>
                      <th style={{ padding: "14px 16px", borderBottom: "2px solid #e5e7eb" }}>Qtd. Títulos</th>
                      <th style={{ padding: "14px 16px", borderBottom: "2px solid #e5e7eb" }}>Capital Alocado</th>
                      <th style={{ padding: "14px 16px", borderBottom: "2px solid #e5e7eb" }}>% do Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.map((item, idx) => (
                      <tr 
                        key={item.name} 
                        onClick={() => handleSliceClick(item.name)}
                        style={{ borderBottom: "1px solid #e5e7eb", background: idx % 2 === 0 ? "#fff" : "#fafafa", transition: "background 0.2s", cursor: "pointer" }} 
                        onMouseOver={(e) => e.currentTarget.style.background = "#eff6ff"} 
                        onMouseOut={(e) => e.currentTarget.style.background = idx % 2 === 0 ? "#fff" : "#fafafa"}
                        title="Clique para ver os títulos detalhados"
                      >
                        <td style={{ padding: "14px 16px", fontWeight: "600", color: "#6b7280" }}>{item.rank}º</td>
                        <td style={{ padding: "14px 16px", fontWeight: "600", color: "#4f46e5" }}>{item.name}</td>
                        <td style={{ padding: "14px 16px", fontWeight: "600", color: item.hasVar ? (item.varPct > 0 ? "#10b981" : item.varPct < 0 ? "#ef4444" : "#6b7280") : "#9ca3af" }}>
                          {item.hasVar ? `${item.varPct > 0 ? '+' : ''}${item.varPct.toFixed(1).replace('.', ',')}%` : '-'}
                        </td>
                        <td style={{ padding: "14px 16px", color: "#4b5563" }}>{item.count}</td>
                        <td style={{ padding: "14px 16px", fontWeight: "700", color: "#059669" }}>{formatarMoeda(item.val)}</td>
                        <td style={{ padding: "14px 16px", fontWeight: "600", color: "#3b82f6" }}>{(item.percent * 100).toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Tooltip do Gráfico de Pizza */}
      {tooltip.show && (
        <div style={{ position: 'fixed', top: tooltip.y + 15, left: tooltip.x + 15, background: 'rgba(17, 24, 39, 0.95)', color: '#fff', padding: '12px 16px', borderRadius: '8px', pointerEvents: 'none', zIndex: 9999, boxShadow: '0 10px 15px -3px rgba(0,0,0,0.3)' }}>
          <div style={{ fontWeight: 700, fontSize: "14px", color: '#f3f4f6', marginBottom: "4px" }}>{tooltip.label}</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#10b981' }}>{formatarMoeda(tooltip.value)}</div>
          <div style={{ marginTop: '2px', fontSize: '13px', color: '#9ca3af' }}>Representa {(tooltip.percent * 100).toFixed(1)}% do capital em aberto</div>
          <div style={{ marginTop: '6px', fontSize: '11px', color: '#60a5fa', fontStyle: 'italic' }}>Clique para ver os detalhes</div>
        </div>
      )}
    </div>
  );
}