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
  "23 -", // Novo cedente ignorado adicionado
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
function MacroDetailedTable({ rows, focus }) {
  const [sortConfig, setSortConfig] = useState(null);

  const colunasOcultas = ["id", "created_at", "Cód.Red", "UF", "Banco", "Rec.", "Estado", "_status"];

  const columns = useMemo(() => {
    const set = new Set();
    for (const r of rows) Object.keys(r).forEach((k) => set.add(k));
    
    let cols = Array.from(set).filter(c => !colunasOcultas.includes(c));

    // Esconde a entidade que já está focada para evitar redundância
    if (focus === 'cedente') cols = cols.filter(c => c !== "Cliente");
    if (focus === 'sacado') cols = cols.filter(c => c !== "Sacado");

    // Traz a contraparte para a frente
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
        const isCurrency = keyLower === "entrada" || keyLower === "vl pgto" || keyLower.includes("valor");
        const isDateColumn = !isCurrency && (keyLower.includes("emis") || keyLower.includes("vcto") || keyLower.includes("pgto") || keyLower.includes("data"));

        if (isDateColumn) {
          const dateA = aValue ? new Date(aValue).getTime() : 0;
          const dateB = bValue ? new Date(bValue).getTime() : 0;
          return activeSort.direction === 'asc' ? dateA - dateB : dateB - dateA;
        } else if (isCurrency) {
          return activeSort.direction === 'asc' ? Number(aValue) - Number(bValue) : Number(bValue) - Number(aValue);
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
                  const isCurrency = cLower === "entrada" || cLower === "vl pgto" || cLower.includes("valor");
                  const isDateColumn = !isCurrency && (cLower.includes("emis") || cLower.includes("vcto") || cLower.includes("pgto") || cLower.includes("data"));
                  
                  if (isDateColumn) valor = formatarData(valor);
                  else if (isCurrency) valor = formatarMoeda(valor);

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
  const [focus, setFocus] = useState('cedente'); // 'cedente' ou 'sacado'
  
  const [hoveredSlice, setHoveredSlice] = useState(null);
  const [selectedSlice, setSelectedSlice] = useState(null); 
  const [tooltip, setTooltip] = useState({ show: false, x: 0, y: 0, label: '', value: 0, percent: 0 });

  // Limpa a seleção ao trocar o foco
  useEffect(() => {
    setSelectedSlice(null);
  }, [focus]);

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

  // 1. Processa todos os registos para encontrar os "Em Aberto" e os agrupa
  const { openRows, stats } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const abertos = [];
    const grouped = {};
    let totalVal = 0;

    // Filtra e classifica os títulos
    rows.forEach(r => {
      let status = 'invalido';
      const vctoKey = Object.keys(r).find(k => k.toLowerCase() === 'vcto' || (k.toLowerCase().includes('vcto') && !k.toLowerCase().includes('vl')));
      const pgtoKey = Object.keys(r).find(k => k.toLowerCase() === 'pgto' || (k.toLowerCase().includes('pgto') && !k.toLowerCase().includes('vl')));
      const statusKey = Object.keys(r).find(k => k.toLowerCase() === 'status' || k.toLowerCase() === 'estado');
      
      const vctoVal = vctoKey ? r[vctoKey] : null;
      const pgtoVal = pgtoKey ? r[pgtoKey] : null;
      const statusVal = statusKey ? String(r[statusKey]).trim().toUpperCase() : "";

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

        const entity = focus === 'cedente' ? r.Cliente : r.Sacado;
        if (entity) {
          const eName = String(entity).trim();
          const valKey = Object.keys(r).find(k => k.toLowerCase() === 'entrada' || k.toLowerCase().includes('valor'));
          const val = valKey ? (Number(r[valKey]) || 0) : 0;

          if (!grouped[eName]) grouped[eName] = { val: 0, count: 0 };
          grouped[eName].val += val;
          grouped[eName].count += 1;
          totalVal += val;
        }
      }
    });

    // Ordena do maior para o menor
    const sorted = Object.keys(grouped).map(k => ({
      name: k,
      val: grouped[k].val,
      count: grouped[k].count,
      percent: totalVal > 0 ? grouped[k].val / totalVal : 0
    })).sort((a, b) => b.val - a.val).map((item, idx) => ({ ...item, rank: idx + 1 }));

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

  // 2. Extrai os detalhes da entidade selecionada (para mostrar na tabela micro)
  const detailedRows = useMemo(() => {
    if (!selectedSlice || selectedSlice.startsWith('Restante')) return null;
    return openRows.filter(r => {
      const entity = focus === 'cedente' ? r.Cliente : r.Sacado;
      return String(entity).trim() === selectedSlice;
    });
  }, [openRows, selectedSlice, focus]);

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
          <button onClick={() => setFocus('cedente')} style={getTabStyle(focus === 'cedente')}>Concentração Cedente</button>
          <button onClick={() => setFocus('sacado')} style={getTabStyle(focus === 'sacado')}>Concentração Sacado</button>
        </div>
      </div>

      {stats.totalVal === 0 ? (
        <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af", background: "#f9fafb", borderRadius: "8px", border: "1px dashed #d1d5db" }}>
          Nenhum título em aberto para análise no momento.
        </div>
      ) : (
        <>
          {/* Gráfico de Pizza Top 9 + Restante */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "40px", alignItems: "center", padding: "32px", background: "#f9fafb", borderRadius: "12px", marginBottom: "24px", border: "1px solid #e5e7eb" }}>
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

          {/* Troca Dinâmica de Tabelas */}
          {detailedRows ? (
            <div style={{ marginTop: "32px" }}>
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
              <MacroDetailedTable rows={detailedRows} focus={focus} />
            </div>
          ) : (
            <div style={{ marginTop: "32px" }}>
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
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "14px", textAlign: "left" }}>
                  <thead>
                    <tr style={{ background: "#f9fafb", color: "#374151" }}>
                      <th style={{ padding: "14px 16px", borderBottom: "2px solid #e5e7eb" }}>Rank Global</th>
                      <th style={{ padding: "14px 16px", borderBottom: "2px solid #e5e7eb" }}>Nome</th>
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