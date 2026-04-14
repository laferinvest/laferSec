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

// --- COMPONENTE DA TABELA DETALHADA DO MACRO (OTIMIZADA) ---
function MacroDetailedTable({ rows, focus, setFocus, setSelectedSlice, hideValues }) {
  const [sortConfig, setSortConfig] = useState(null);
  
  // OTIMIZAÇÃO: Paginação
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  useEffect(() => { setCurrentPage(1); }, [rows, focus, sortConfig]);

  const colunasOcultas = ["id", "created_at", "Cód.Red", "UF", "Banco", "Rec.", "Estado", "_status"];

  const columns = useMemo(() => {
    if (!rows.length) return [];
    const firstRowKeys = Object.keys(rows[0]);
    let cols = firstRowKeys.filter(c => !colunasOcultas.includes(c));

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

  // FATIAR PARA PAGINAÇÃO
  const currentItems = sortedRows.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.ceil(sortedRows.length / itemsPerPage);

  if (!rows.length) return null;

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", display: "flex", flexDirection: "column" }}>
      <div style={{ overflowX: "auto" }}>
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
            {currentItems.map((r, idx) => {
              return (
                // OTIMIZAÇÃO: Utilizando classe CSS em vez de inline onMouseOver
                <tr key={r.id || idx} className={`macro-table-row-${r._status || 'default'}`} style={{ borderBottom: "1px solid #e5e7eb", transition: "background 0.2s" }}>
                  {columns.map((c) => {
                    let valor = r[c];
                    const cLower = c.toLowerCase();
                    const isCurrency = cLower === "entrada" || cLower === "vl pgto" || cLower.includes("valor") || cLower === "desagio" || cLower === "deságio";
                    const isRate = cLower.includes("tx") || cLower.includes("taxa");
                    const isDateColumn = !isCurrency && !isRate && (cLower.includes("emis") || cLower.includes("vcto") || cLower.includes("pgto") || cLower.includes("data"));
                    
                    if (isDateColumn) valor = formatarData(valor);
                    else if (isCurrency) valor = hideValues ? "R$ -" : formatarMoeda(valor);
                    else if (isRate) {
                      const valNum = Number(String(valor).replace('%', '').replace(',', '.'));
                      valor = !isNaN(valNum) && valor ? `${valNum.toFixed(2).replace('.', ',')}%` : escapeText(valor);
                    }

                    // Cross-Navigation Otimizado (Sem JavaScript Inline Styles)
                    if (c === "Cliente" && focus === 'sacado') {
                      return (
                        <td key={c} style={{ padding: "12px 16px", color: "#374151" }}>
                          <span onClick={() => { setFocus('cedente'); setSelectedSlice(r[c]); }} className="cross-nav-cedente">
                            {escapeText(valor)}
                          </span>
                        </td>
                      );
                    }
                    if (c === "Sacado" && focus === 'cedente') {
                      return (
                        <td key={c} style={{ padding: "12px 16px", color: "#374151" }}>
                          <span onClick={() => { setFocus('sacado'); setSelectedSlice(r[c]); }} className="cross-nav-sacado">
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
      
      {/* Controlos de Paginação */}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: '#fff', borderTop: '1px solid #e5e7eb', alignItems: 'center', borderRadius: "0 0 8px 8px" }}>
          <span style={{ fontSize: '13px', color: '#6b7280' }}>
            Mostrando {sortedRows.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0} a {Math.min(currentPage * itemsPerPage, sortedRows.length)} de {sortedRows.length} registos
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #d1d5db', background: currentPage === 1 ? '#f3f4f6' : '#fff', color: currentPage === 1 ? '#9ca3af' : '#374151', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', fontSize: '13px' }}>Anterior</button>
            <button disabled={currentPage === totalPages || totalPages === 0} onClick={() => setCurrentPage(p => p + 1)} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #d1d5db', background: currentPage === totalPages || totalPages === 0 ? '#f3f4f6' : '#fff', color: currentPage === totalPages || totalPages === 0 ? '#9ca3af' : '#374151', cursor: currentPage === totalPages || totalPages === 0 ? 'not-allowed' : 'pointer', fontSize: '13px' }}>Próxima</button>
          </div>
      </div>
    </div>
  );
}


// --- DASHBOARD MACRO PRINCIPAL ---
export default function MacroDashboard({ session, hideValues, setHideValues }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [focus, setFocus] = useState('cedente'); 
  const fmtM = (valor) => hideValues ? "R$ -" : formatarMoeda(valor);
  
  const [hoveredSlice, setHoveredSlice] = useState(null);
  const [hoveredNegotiationSlice, setHoveredNegotiationSlice] = useState(null);
  const [hoveredNegotiationDesEncSlice, setHoveredNegotiationDesEncSlice] = useState(null);
  const [selectedSlice, setSelectedSlice] = useState(null); 
  const [volumePeriod, setVolumePeriod] = useState('mes_atual');
  const [volumeDateBase, setVolumeDateBase] = useState('emissao');
  const [negotiationPage, setNegotiationPage] = useState(1);
  const [capitalPage, setCapitalPage] = useState(1);
  const [tooltip, setTooltip] = useState({ show: false, x: 0, y: 0, label: '', value: 0, percent: 0, context: 'capital_aberto' });

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

  // 1. Processa os registos em aberto e o volume negociado por período
  const { openRows, stats, negotiationStats } = useMemo(() => {
    const emptyChart = { totalVal: 0, totalDesEnc: 0, sorted: [], pieData: [], pieDataDesEnc: [] };
    if (rows.length === 0) return { openRows: [], stats: emptyChart, negotiationStats: { mes_atual: emptyChart, ult_30_dias: emptyChart, ytd: emptyChart } };

    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    monthStart.setHours(0, 0, 0, 0);

    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const sixtyDaysAgo = new Date(today);
    sixtyDaysAgo.setDate(today.getDate() - 60);
    sixtyDaysAgo.setHours(0, 0, 0, 0);

    const yearStart = new Date(today.getFullYear(), 0, 1);
    yearStart.setHours(0, 0, 0, 0);
    
    const abertos = [];
    const grouped = {};
    const monthlyVolume = {};
    const negotiationGrouped = {
      mes_atual: {},
      ult_30_dias: {},
      ytd: {}
    };
    let totalVal = 0;

    const firstRow = rows[0];
    const vctoKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'vcto' || (k.toLowerCase().includes('vcto') && !k.toLowerCase().includes('vl')));
    const pgtoKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'pgto' || (k.toLowerCase().includes('pgto') && !k.toLowerCase().includes('vl')));
    const statusKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'status' || k.toLowerCase() === 'estado');
    const emisKey = Object.keys(firstRow).find(k => k.toLowerCase().includes('emis'));
    const valKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'entrada' || (k.toLowerCase().includes('valor') && !k.toLowerCase().includes('pgto')));
    const vlPgtoKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'vl pgto');
    const borderoKey = Object.keys(firstRow).find(k => k.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes("border"));
    const desagioKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'desagio' || k.toLowerCase() === 'deságio');

    const periodConfigs = {
      mes_atual: { start: monthStart, end: today },
      ult_30_dias: { start: thirtyDaysAgo, end: today },
      ytd: { start: yearStart, end: today }
    };

    const seenPeriodBorderosDesagio = {
      mes_atual: new Map(),
      ult_30_dias: new Map(),
      ytd: new Map()
    };

    rows.forEach((r, idx) => {
      let status = 'invalido';
      
      const vctoVal = vctoKey ? r[vctoKey] : null;
      const pgtoVal = pgtoKey ? r[pgtoKey] : null;
      const statusVal = statusKey ? String(r[statusKey]).trim().toUpperCase() : "";
      const val = valKey ? (Number(r[valKey]) || 0) : 0;
      const vlPgto = vlPgtoKey ? (Number(r[vlPgtoKey]) || 0) : 0;
      const desagioVal = desagioKey ? (Number(r[desagioKey]) || 0) : 0;
      const borderoNum = (borderoKey && r[borderoKey]) ? String(r[borderoKey]).trim() : `avulso_${idx}`;

      const temPgto = pgtoKey && r[pgtoKey] && String(r[pgtoKey]).trim() !== "";
      const encargoPossivel = temPgto && vlPgto > 0 && val > 0 && vlPgto !== val;
      const encargo = encargoPossivel && vlPgto <= val * 1.4 ? Math.max(0, vlPgto - val) : 0;

      const entity = focus === 'cedente' ? r.Cliente : r.Sacado;
      const eName = entity ? String(entity).trim() : null;

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

      const emisDate = emisKey && r[emisKey]
        ? new Date(String(r[emisKey]).split("T")[0] + "T00:00:00")
        : null;

      let effectiveVctoDate = null;
      if (vctoVal) {
        effectiveVctoDate = new Date(String(vctoVal).split("T")[0] + "T00:00:00");
        if (effectiveVctoDate.getDay() === 6) effectiveVctoDate.setDate(effectiveVctoDate.getDate() + 2);
        else if (effectiveVctoDate.getDay() === 0) effectiveVctoDate.setDate(effectiveVctoDate.getDate() + 1);
      }

      if (eName && emisDate) {
        if (emisDate >= thirtyDaysAgo && emisDate <= today) {
          if (!monthlyVolume[eName]) monthlyVolume[eName] = { lm: 0, plm: 0 };
          monthlyVolume[eName].lm += val;
        } else if (emisDate >= sixtyDaysAgo && emisDate < thirtyDaysAgo) {
          if (!monthlyVolume[eName]) monthlyVolume[eName] = { lm: 0, plm: 0 };
          monthlyVolume[eName].plm += val;
        }

        const negotiationDate = volumeDateBase === 'vencimento' ? effectiveVctoDate : emisDate;
        const canUseByVencimento = volumeDateBase !== 'vencimento' || ['liquidado', 'liquidadoAtraso', 'recompra'].includes(status);

        if (negotiationDate && canUseByVencimento) {
          Object.entries(periodConfigs).forEach(([periodKey, range]) => {
            if (negotiationDate >= range.start && negotiationDate <= range.end) {
              if (!negotiationGrouped[periodKey][eName]) negotiationGrouped[periodKey][eName] = { val: 0, desEnc: 0 };
              negotiationGrouped[periodKey][eName].val += val;
              negotiationGrouped[periodKey][eName].desEnc += encargo;

              if (!seenPeriodBorderosDesagio[periodKey].has(borderoNum)) {
                seenPeriodBorderosDesagio[periodKey].set(borderoNum, new Set());
              }
              const entitiesSeen = seenPeriodBorderosDesagio[periodKey].get(borderoNum);
              if (!entitiesSeen.has(eName)) {
                entitiesSeen.add(eName);
                negotiationGrouped[periodKey][eName].desEnc += desagioVal;
              }
            }
          });
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

    const colors = ['#4f46e5', '#60a5fa', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#0ea5e9', '#f97316', '#6366f1', '#9ca3af'];
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

    const buildNegotiationChart = (groupMap) => {
      const entries = Object.entries(groupMap || {});
      const groupTotal = entries.reduce((acc, [, curr]) => acc + (Number(curr?.val) || 0), 0);
      const groupTotalDesEnc = entries.reduce((acc, [, curr]) => acc + (Number(curr?.desEnc) || 0), 0);

      const groupSorted = entries
        .map(([name, curr], idx) => ({
          rank: idx + 1,
          name,
          val: Number(curr?.val) || 0,
          desEnc: Number(curr?.desEnc) || 0,
          percent: groupTotal > 0 ? (Number(curr?.val) || 0) / groupTotal : 0,
          percentDesEnc: groupTotalDesEnc > 0 ? (Number(curr?.desEnc) || 0) / groupTotalDesEnc : 0
        }))
        .sort((a, b) => b.val - a.val)
        .map((item, idx) => ({ ...item, rank: idx + 1 }));

      const topSlices = groupSorted.slice(0, 9).map((item, idx) => ({ ...item, color: colors[idx] }));
      const otherSlices = groupSorted.slice(9);
      if (otherSlices.length > 0) {
        const otherVal = otherSlices.reduce((acc, curr) => acc + curr.val, 0);
        const otherDesEnc = otherSlices.reduce((acc, curr) => acc + curr.desEnc, 0);
        topSlices.push({
          name: `Restante (${otherSlices.length} outros)`,
          val: otherVal,
          desEnc: otherDesEnc,
          percent: groupTotal > 0 ? otherVal / groupTotal : 0,
          percentDesEnc: groupTotalDesEnc > 0 ? otherDesEnc / groupTotalDesEnc : 0,
          color: colors[9]
        });
      }

      const groupSortedDesEnc = [...groupSorted]
        .sort((a, b) => b.desEnc - a.desEnc)
        .map((item, idx) => ({ ...item, rankDesEnc: idx + 1 }));

      const topSlicesDesEnc = groupSortedDesEnc.slice(0, 9).map((item, idx) => ({
        ...item,
        val: item.desEnc,
        percent: item.percentDesEnc,
        color: colors[idx]
      }));
      const otherSlicesDesEnc = groupSortedDesEnc.slice(9);
      if (otherSlicesDesEnc.length > 0) {
        const otherVal = otherSlicesDesEnc.reduce((acc, curr) => acc + curr.desEnc, 0);
        topSlicesDesEnc.push({
          name: `Restante (${otherSlicesDesEnc.length} outros)`,
          val: otherVal,
          desEnc: otherVal,
          percent: groupTotalDesEnc > 0 ? otherVal / groupTotalDesEnc : 0,
          percentDesEnc: groupTotalDesEnc > 0 ? otherVal / groupTotalDesEnc : 0,
          color: colors[9]
        });
      }

      return { totalVal: groupTotal, totalDesEnc: groupTotalDesEnc, sorted: groupSorted, sortedDesEnc: groupSortedDesEnc, pieData: topSlices, pieDataDesEnc: topSlicesDesEnc };
    };

    return {
      openRows: abertos,
      stats: { totalVal, sorted, pieData: top9 },
      negotiationStats: {
        mes_atual: buildNegotiationChart(negotiationGrouped.mes_atual),
        ult_30_dias: buildNegotiationChart(negotiationGrouped.ult_30_dias),
        ytd: buildNegotiationChart(negotiationGrouped.ytd)
      }
    };
  }, [rows, focus, volumeDateBase]);

  // 2. Extrai os detalhes da entidade selecionada
  const detailedRows = useMemo(() => {
    if (!selectedSlice || selectedSlice.startsWith('Restante')) return null;
    return openRows.filter(r => {
      const entity = focus === 'cedente' ? r.Cliente : r.Sacado;
      return String(entity).trim() === selectedSlice;
    });
  }, [openRows, selectedSlice, focus]);

  // 3. Calcula os KPIs com base na visualização atual (Global ou Específica)
  const riscoAtual = useMemo(() => {
    const riscoRows = detailedRows || openRows;
    if (!riscoRows || riscoRows.length === 0) return 0;

    const firstRow = riscoRows[0];
    const valKey = Object.keys(firstRow).find(
      k => k.toLowerCase() === 'entrada' || (k.toLowerCase().includes('valor') && !k.toLowerCase().includes('pgto'))
    );

    if (!valKey) return 0;

    return riscoRows.reduce((acc, row) => acc + (Number(row[valKey]) || 0), 0);
  }, [detailedRows, openRows]);

  const kpiData = useMemo(() => {
    const kpiRows = detailedRows || openRows;

    if (!kpiRows || kpiRows.length === 0) {
      return {
        riscoAtual: 0,
        taxaMedia: 0,
        baseCalculo: 0,
        qtdBorderos: 0,
        qtdTitulos: 0,
        valorMedioBordero: 0,
        valorMedioTitulo: 0,
        prazoMedio: 0,
        desagioTotal: 0,
        encargosTotal: 0,
        diasOperacao: 0
      };
    }

    const borderoMap = new Map();
    let sumFaceTotal = 0;
    let sumPrazoWeighted = 0;
    let countTitulos = 0;

    const firstRow = kpiRows[0];
    const borderoKey = Object.keys(firstRow).find(k => k.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes("border"));
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
    let minDate = null;
    let maxDate = null;

    kpiRows.forEach((r, idx) => {
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

    let diasOperacao = 1;
    if (minDate && maxDate) {
      const diff = Math.round((maxDate - minDate) / (1000 * 60 * 60 * 24));
      diasOperacao = Math.max(1, diff);
    }

    return {
      riscoAtual,
      taxaMedia: baseCalculoTaxa > 0 ? (sumTaxaWeighted / baseCalculoTaxa) : 0,
      baseCalculo: baseCalculoTaxa,
      qtdBorderos: borderoMap.size,
      qtdTitulos: countTitulos,
      valorMedioBordero: borderoMap.size > 0 ? sumFaceTotal / borderoMap.size : 0,
      valorMedioTitulo: countTitulos > 0 ? sumFaceTotal / countTitulos : 0,
      prazoMedio: sumFaceTotal > 0 ? sumPrazoWeighted / sumFaceTotal : 0,
      desagioTotal: totalDesagio,
      encargosTotal: totalEncargos,
      diasOperacao
    };
  }, [detailedRows, openRows, riscoAtual]);


  const tableData = useMemo(() => {
    if (!selectedSlice) return stats.sorted;
    if (selectedSlice.startsWith('Restante')) return stats.sorted.slice(9);
    return stats.sorted.filter(item => item.name === selectedSlice);
  }, [stats.sorted, selectedSlice]);

  const currentNegotiationStats = negotiationStats[volumePeriod] || { totalVal: 0, totalDesEnc: 0, sorted: [], pieData: [], pieDataDesEnc: [] };

  useEffect(() => {
    setNegotiationPage(1);
  }, [volumePeriod, focus]);

  const negotiationTableItems = useMemo(() => {
    return (currentNegotiationStats.sorted || []).filter(item => !String(item.name || '').startsWith('Restante'));
  }, [currentNegotiationStats]);

  const negotiationItemsPerPage = 10;
  const negotiationTotalPages = Math.max(1, Math.ceil(negotiationTableItems.length / negotiationItemsPerPage));
  const negotiationPageSafe = Math.min(negotiationPage, negotiationTotalPages);
  const negotiationPageItems = negotiationTableItems.slice(
    (negotiationPageSafe - 1) * negotiationItemsPerPage,
    negotiationPageSafe * negotiationItemsPerPage
  );

  useEffect(() => {
    setCapitalPage(1);
  }, [focus, selectedSlice, stats.sorted]);

  const capitalTableItems = useMemo(() => {
    return (stats.sorted || []).filter(item => !String(item.name || '').startsWith('Restante'));
  }, [stats.sorted]);

  const capitalItemsPerPage = 10;
  const capitalTotalPages = Math.max(1, Math.ceil(capitalTableItems.length / capitalItemsPerPage));
  const capitalPageSafe = Math.min(capitalPage, capitalTotalPages);
  const capitalPageItems = capitalTableItems.slice(
    (capitalPageSafe - 1) * capitalItemsPerPage,
    capitalPageSafe * capitalItemsPerPage
  );

  const capitalTop5Percent = stats.sorted.length
  ? stats.sorted.slice(0, 5).reduce((acc, item) => acc + item.percent, 0) * 100
  : 0;

const negotiationTop5Percent = currentNegotiationStats.sorted.length
  ? currentNegotiationStats.sorted.slice(0, 5).reduce((acc, item) => acc + item.percent, 0) * 100
  : 0;

const negotiationDesEncTop5Percent = currentNegotiationStats.sorted.length
  ? currentNegotiationStats.sorted.slice(0, 5).reduce((acc, item) => acc + item.percentDesEnc, 0) * 100
  : 0;

  const handleMouseMove = (e, slice) => {
    setTooltip({ show: true, x: e.clientX, y: e.clientY, label: slice.name, value: slice.val, percent: slice.percent, context: 'capital_aberto' });
    setHoveredSlice(slice.name);
  };

  const handleNegotiationMouseMove = (e, slice) => {
    setTooltip({ show: true, x: e.clientX, y: e.clientY, label: slice.name, value: slice.val, percent: slice.percent, context: 'volume_negociado' });
    setHoveredNegotiationSlice(slice.name);
  };

  const handleNegotiationDesEncMouseMove = (e, slice) => {
    setTooltip({ show: true, x: e.clientX, y: e.clientY, label: slice.name, value: slice.val, percent: slice.percent, context: 'des_enc_negociado' });
    setHoveredNegotiationDesEncSlice(slice.name);
  };

  const handleSliceClick = (sliceName) => {
    setSelectedSlice(prev => prev === sliceName ? null : sliceName);
  };

  const getVolumePeriodStyle = (isActive) => ({
    padding: "8px 14px", borderRadius: "8px", border: "1px solid", borderColor: isActive ? "#4f46e5" : "#d1d5db",
    background: isActive ? "#eef2ff" : "#fff", color: isActive ? "#4338ca" : "#6b7280",
    fontWeight: "700", fontSize: "13px", cursor: "pointer", transition: "all 0.2s", whiteSpace: "nowrap"
  });

  const buildPieSegments = (pieData) => {
    let cumulative = 0;
    return pieData.map((slice) => {
      const startPercent = cumulative;
      cumulative += slice.percent;
      const endPercent = cumulative;
      return { ...slice, startPercent, endPercent };
    });
  };

  const renderDonutChart = ({ pieData, hoveredName, selectedName = null, onSliceClick, onSliceHover, onMouseLeave, donut = true, size = 260 }) => {
    const segments = buildPieSegments(pieData);
    return (
      <div style={{ width: `${size}px`, maxWidth: "100%", aspectRatio: "1 / 1", position: "relative" }}>
        <svg
          viewBox={donut ? "-1.25 -1.25 2.5 2.5" : "-1.1 -1.1 2.2 2.2"}
          style={{ transform: 'rotate(-90deg)', overflow: 'visible', width: '100%', height: '100%', filter: 'drop-shadow(0px 10px 20px rgba(79,70,229,0.12))' }}
          onMouseLeave={onMouseLeave}
        >
          {segments.map((slice) => {
            if (!slice.percent) return null;
            const isDimmed = selectedName && selectedName !== slice.name;
            const sliceOpacity = isDimmed ? 0.25 : 1;
            const isHovered = hoveredName === slice.name;

            if (slice.percent >= 0.9999) {
              return donut ? (
                <circle
                  key={slice.name}
                  cx="0"
                  cy="0"
                  r="0.92"
                  fill="none"
                  stroke={slice.color}
                  strokeWidth="0.42"
                  strokeLinecap="butt"
                  onMouseMove={(e) => onSliceHover(e, slice)}
                  onClick={() => onSliceClick && onSliceClick(slice.name)}
                  style={{ opacity: sliceOpacity, transition: 'all 0.2s', cursor: onSliceClick ? 'pointer' : 'default', transform: isHovered ? 'scale(1.03)' : 'scale(1)', transformOrigin: '0 0' }}
                />
              ) : (
                <circle
                  key={slice.name}
                  cx="0"
                  cy="0"
                  r="1"
                  fill={slice.color}
                  onMouseMove={(e) => onSliceHover(e, slice)}
                  onClick={() => onSliceClick && onSliceClick(slice.name)}
                  style={{ opacity: sliceOpacity, transition: 'all 0.2s', cursor: onSliceClick ? 'pointer' : 'default', transform: isHovered ? 'scale(1.03)' : 'scale(1)', transformOrigin: '0 0' }}
                />
              );
            }

            if (donut) {
              const radius = 0.92;
              const circumference = 2 * Math.PI * radius;
              const length = slice.percent * circumference;
              const gap = Math.max(circumference - length, 0);
              return (
                <circle
                  key={slice.name}
                  cx="0"
                  cy="0"
                  r={radius}
                  fill="none"
                  stroke={slice.color}
                  strokeWidth="0.42"
                  strokeDasharray={`${length} ${gap}`}
                  strokeDashoffset={-slice.startPercent * circumference}
                  strokeLinecap="butt"
                  onMouseMove={(e) => onSliceHover(e, slice)}
                  onClick={() => onSliceClick && onSliceClick(slice.name)}
                  style={{ opacity: sliceOpacity, transition: 'all 0.2s', cursor: onSliceClick ? 'pointer' : 'default', transform: isHovered ? 'scale(1.03)' : 'scale(1)', transformOrigin: '0 0' }}
                />
              );
            }

            const startX = Math.cos(2 * Math.PI * slice.startPercent);
            const startY = Math.sin(2 * Math.PI * slice.startPercent);
            const endX = Math.cos(2 * Math.PI * slice.endPercent);
            const endY = Math.sin(2 * Math.PI * slice.endPercent);
            const largeArcFlag = slice.percent > 0.5 ? 1 : 0;
            const pathData = `M 0 0 L ${startX} ${startY} A 1 1 0 ${largeArcFlag} 1 ${endX} ${endY} Z`;

            return (
              <path
                key={slice.name}
                d={pathData}
                fill={slice.color}
                onMouseMove={(e) => onSliceHover(e, slice)}
                onClick={() => onSliceClick && onSliceClick(slice.name)}
                style={{ opacity: sliceOpacity, transition: 'all 0.2s', cursor: onSliceClick ? 'pointer' : 'default', transform: isHovered ? 'scale(1.03)' : 'scale(1)', transformOrigin: '0 0' }}
              />
            );
          })}
          {donut && <circle cx="0" cy="0" r="0.48" fill="#ffffff" />}
        </svg>
      </div>
    );
  };

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
      {/* OTIMIZAÇÃO CSS: Bloco de estilo global para os eventos de Hover do MacroDashboard */}
      <style>
        {`
          .macro-table-row-atraso { background: rgba(239, 68, 68, 0.08); }
          .macro-table-row-atraso:hover { background: rgba(239, 68, 68, 0.15); }
          .macro-table-row-aVencer { background: rgba(148, 163, 184, 0.05); }
          .macro-table-row-aVencer:hover { background: rgba(148, 163, 184, 0.12); }
          .macro-table-row-default { background: #fff; }
          .macro-table-row-default:hover { background: #f9fafb; }
          
          .cross-nav-cedente { cursor: pointer; font-weight: 600; color: #4f46e5; text-decoration: underline; text-decoration-color: transparent; transition: all 0.2s; }
          .cross-nav-cedente:hover { text-decoration-color: #4f46e5; }
          
          .cross-nav-sacado { cursor: pointer; font-weight: 600; color: #0ea5e9; text-decoration: underline; text-decoration-color: transparent; transition: all 0.2s; }
          .cross-nav-sacado:hover { text-decoration-color: #0ea5e9; }

          .ranking-row { border-bottom: 1px solid #e5e7eb; transition: background 0.2s; cursor: pointer; }
          .ranking-row-even { background: #fff; }
          .ranking-row-odd { background: #fafafa; }
          .ranking-row:hover { background: #eff6ff !important; }

          .btn-voltar { padding: 8px 16px; border-radius: 8px; border: 1px solid #d1d5db; background: #fff; cursor: pointer; font-size: 13px; font-weight: 600; color: #374151; transition: all 0.2s; }
          .btn-voltar:hover { background: #f9fafb; }
        `}
      </style>

      {/* Cabeçalho Macro */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h2 style={{ margin: "0 0 8px 0", color: "#111827", fontSize: "22px" }}>Visão Macroscópica de Risco</h2>
          <p style={{ margin: 0, color: "#6b7280", fontSize: "15px" }}>Concentração de Capital em títulos <strong>Em Aberto</strong> (A Vencer e Em Atraso).</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "10px" }}>
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <button
              onClick={() => setHideValues(v => !v)}
              title={hideValues ? "Mostrar valores" : "Ocultar valores"}
              style={{ padding: "8px 10px", borderRadius: "6px", border: "1px solid #d1d5db", background: hideValues ? "#f3f4f6" : "#fff", color: hideValues ? "#4f46e5" : "#6b7280", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}
            >
              {hideValues ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              )}
            </button>
            <button onClick={() => { setFocus('cedente'); setSelectedSlice(null); }} style={getTabStyle(focus === 'cedente')}>Concentração Cedente</button>
            <button onClick={() => { setFocus('sacado'); setSelectedSlice(null); }} style={getTabStyle(focus === 'sacado')}>Concentração Sacado</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", justifyContent: "flex-end", flexWrap: "wrap" }}>
            <span style={{ fontSize: "13px", fontWeight: "700", color: "#6b7280" }}>Data-base</span>
            <button onClick={() => setVolumeDateBase('emissao')} style={getVolumePeriodStyle(volumeDateBase === 'emissao')}>Emissão</button>
            <button onClick={() => setVolumeDateBase('vencimento')} style={getVolumePeriodStyle(volumeDateBase === 'vencimento')}>Vencimento</button>
          </div>
        </div>       
      </div>

      {stats.totalVal === 0 ? (
        <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af", background: "#f9fafb", borderRadius: "8px", border: "1px dashed #d1d5db" }}>
          Nenhum título em aberto para análise no momento.
        </div>
      ) : (
        <>
          {/* Container superior: Volume negociado */}
          <section style={{ background: "#f3f4f6", borderRadius: "20px", padding: "20px", marginBottom: "28px", border: "1px solid #e5e7eb" }}>
            <div style={{
              background: "#ffffff",
              borderRadius: "18px",
              padding: "24px",
              border: "1px solid #e5e7eb",
              boxShadow: "0 10px 25px rgba(15, 23, 42, 0.06)"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap", marginBottom: "20px" }}>
                <div>
                  <h3 style={{ margin: "0 0 6px 0", color: "#1f2937", fontSize: "26px", fontWeight: "800", letterSpacing: "-0.02em" }}>
                    Volume de Negociação
                  </h3>
                  <p style={{ margin: 0, color: "#6b7280", fontSize: "14px" }}>
                    Distribuição do volume negociado por {focus === 'cedente' ? 'cedente' : 'sacado'} no período selecionado.
                  </p>
                </div>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                  <button onClick={() => setVolumePeriod('mes_atual')} style={getVolumePeriodStyle(volumePeriod === 'mes_atual')}>Mês Atual</button>
                  <button onClick={() => setVolumePeriod('ult_30_dias')} style={getVolumePeriodStyle(volumePeriod === 'ult_30_dias')}>Últ. 30 Dias</button>
                  <button onClick={() => setVolumePeriod('ytd')} style={getVolumePeriodStyle(volumePeriod === 'ytd')}>YTD</button>
                </div>
              </div>

              {currentNegotiationStats.totalVal === 0 ? (
                <div style={{ padding: "32px", textAlign: "center", color: "#9ca3af", background: "#f9fafb", borderRadius: "14px", border: "1px dashed #d1d5db" }}>
                  Nenhum volume negociado encontrado para o período selecionado.
                </div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "28px", alignItems: "stretch" }}>
                  <div style={{
                    flex: "0 0 390px",
                    minWidth: "300px",
                    maxWidth: "100%",
                    border: "1px solid #d1d5db",
                    borderRadius: "18px",
                    background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
                    padding: "24px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "flex-start",
                    gap: "20px"
                  }}>
                    <div style={{
                      width: "100%",
                      background: "#ffffff",
                      border: "1px solid #e5e7eb",
                      boxShadow: "0 8px 18px rgba(15, 23, 42, 0.08)",
                      borderRadius: "16px",
                      padding: "18px 16px",
                      textAlign: "center"
                    }}>
                      <div style={{ fontSize: "12px", fontWeight: "800", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>
                        Volume Negociado
                      </div>
                      <div style={{ fontSize: "28px", fontWeight: "900", color: "#0f172a", letterSpacing: "-0.03em", lineHeight: 1.1 }}>
                        {fmtM(currentNegotiationStats.totalVal)}
                      </div>
                      <div style={{ marginTop: "10px", fontSize: "14px", color: "#64748b", fontWeight: "700" }}>
                        Top 5 = {negotiationTop5Percent.toFixed(1).replace('.', ',')}%
                      </div>
                    </div>

                    {renderDonutChart({
                      pieData: currentNegotiationStats.pieData,
                      hoveredName: hoveredNegotiationSlice,
                      onSliceHover: handleNegotiationMouseMove,
                      onMouseLeave: () => { setTooltip({ show: false }); setHoveredNegotiationSlice(null); },
                      donut: true,
                      size: 230
                    })}

                    <div style={{
                      width: "100%",
                      background: "#ffffff",
                      border: "1px solid #e5e7eb",
                      boxShadow: "0 8px 18px rgba(15, 23, 42, 0.08)",
                      borderRadius: "16px",
                      padding: "18px 16px",
                      textAlign: "center"
                    }}>
                      <div style={{ fontSize: "12px", fontWeight: "800", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>
                        Deságio + Encargos
                      </div>
                      <div style={{ fontSize: "28px", fontWeight: "900", color: "#0f172a", letterSpacing: "-0.03em", lineHeight: 1.1 }}>
                        {fmtM(currentNegotiationStats.totalDesEnc)}
                      </div>
                      <div style={{ marginTop: "10px", fontSize: "14px", color: "#64748b", fontWeight: "700" }}>
                        Top 5 = {negotiationDesEncTop5Percent.toFixed(1).replace('.', ',')}%
                      </div>
                    </div>

                    {renderDonutChart({
                      pieData: currentNegotiationStats.pieDataDesEnc,
                      hoveredName: hoveredNegotiationDesEncSlice,
                      onSliceHover: handleNegotiationDesEncMouseMove,
                      onMouseLeave: () => { setTooltip({ show: false }); setHoveredNegotiationDesEncSlice(null); },
                      donut: true,
                      size: 230
                    })}
                  </div>

                  <div style={{
                    flex: "1 1 560px",
                    minWidth: "320px",
                    border: "1px solid #d1d5db",
                    borderRadius: "18px",
                    overflow: "hidden",
                    background: "#ffffff"
                  }}>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 240px 240px", background: "#f3f4f6", color: "#526581", fontSize: "13px", fontWeight: "800", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid #d1d5db" }}>
                      <div style={{ padding: "16px 20px" }}>{focus === 'cedente' ? 'Cedente' : 'Sacado'}</div>
                      <div style={{ padding: "16px 20px", textAlign: "right" }}>Volume Negociado</div>
                      <div style={{ padding: "16px 20px", textAlign: "right" }}>Deságio + Encargos</div>
                    </div>
                    {negotiationPageItems.map((slice, idx) => {
                      const globalIndex = (negotiationPageSafe - 1) * negotiationItemsPerPage + idx;
                      const pieSlice = currentNegotiationStats.pieData.find(item => item.name === slice.name);
                      const color = pieSlice?.color || '#94a3b8';
                      return (
                        <div
                          key={slice.name}
                          onMouseEnter={() => setHoveredNegotiationSlice(slice.name)}
                          onMouseLeave={() => setHoveredNegotiationSlice(null)}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "minmax(0, 1fr) 240px 240px",
                            alignItems: "center",
                            borderBottom: globalIndex === negotiationTableItems.length - 1 ? "none" : "1px solid #e5e7eb",
                            background: hoveredNegotiationSlice === slice.name || hoveredNegotiationDesEncSlice === slice.name ? "#eff6ff" : "#fff",
                            transition: "background 0.2s"
                          }}
                        >
                          <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                            <span style={{ width: "12px", height: "12px", borderRadius: "999px", background: color, flexShrink: 0 }} />
                            <span style={{ fontSize: "16px", fontWeight: "700", color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={slice.name}>{slice.name}</span>
                          </div>
                          <div style={{ padding: "16px 20px", textAlign: "right", color: "#0f172a" }}>
                            <div style={{ fontSize: "16px", fontWeight: "800" }}>{fmtM(slice.val)}</div>
                            <div style={{ marginTop: "4px", fontSize: "12px", fontWeight: "600", color: "#64748b" }}>
                              ({(slice.percent * 100).toFixed(2).replace('.', ',')}%)
                            </div>
                          </div>
                          <div style={{ padding: "16px 20px", textAlign: "right", color: "#0f172a" }}>
                            <div style={{ fontSize: "16px", fontWeight: "800" }}>{fmtM(slice.desEnc)}</div>
                            <div style={{ marginTop: "4px", fontSize: "12px", fontWeight: "600", color: "#64748b" }}>
                              ({(slice.percentDesEnc * 100).toFixed(2).replace('.', ',')}%)
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {negotiationTableItems.length > negotiationItemsPerPage && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '14px 16px', borderTop: '1px solid #e5e7eb', background: '#fff' }}>
                        <span style={{ fontSize: '13px', color: '#6b7280' }}>
                          Mostrando {(negotiationPageSafe - 1) * negotiationItemsPerPage + 1} a {Math.min(negotiationPageSafe * negotiationItemsPerPage, negotiationTableItems.length)} de {negotiationTableItems.length} entradas
                        </span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            onClick={() => setNegotiationPage(p => Math.max(1, p - 1))}
                            disabled={negotiationPageSafe === 1}
                            style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #d1d5db', background: negotiationPageSafe === 1 ? '#f3f4f6' : '#fff', color: negotiationPageSafe === 1 ? '#9ca3af' : '#374151', cursor: negotiationPageSafe === 1 ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600 }}
                          >
                            Anterior
                          </button>
                          <button
                            onClick={() => setNegotiationPage(p => Math.min(negotiationTotalPages, p + 1))}
                            disabled={negotiationPageSafe === negotiationTotalPages}
                            style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #d1d5db', background: negotiationPageSafe === negotiationTotalPages ? '#f3f4f6' : '#fff', color: negotiationPageSafe === negotiationTotalPages ? '#9ca3af' : '#374151', cursor: negotiationPageSafe === negotiationTotalPages ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600 }}
                          >
                            Próxima
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Container inferior: concentração de capital em aberto */}
          <section style={{ background: "#f8fafc", borderRadius: "20px", padding: "20px", marginBottom: "32px", border: "1px solid #e5e7eb" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", flexWrap: "wrap", marginBottom: "20px" }}>
              <div>
                <h3 style={{ margin: "0 0 6px 0", color: "#1f2937", fontSize: "26px", fontWeight: "800", letterSpacing: "-0.02em" }}>
                  Concentração por {focus === 'cedente' ? 'Cedente' : 'Sacado'}
                </h3>
                <p style={{ margin: 0, color: "#6b7280", fontSize: "14px" }}>
                  Capital em aberto concentrado nos principais {focus === 'cedente' ? 'cedentes' : 'sacados'}.
                </p>
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "28px", alignItems: "stretch" }}>
              <div style={{
                flex: "0 0 390px",
                minWidth: "300px",
                maxWidth: "100%",
                border: "1px solid #d1d5db",
                borderRadius: "18px",
                background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
                padding: "24px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "space-between"
              }}>
                <div style={{ textAlign: "center", marginBottom: "18px" }}>
                  <div style={{ fontSize: "12px", fontWeight: "800", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>
                    Capital em Aberto
                  </div>
                  <div style={{ fontSize: "28px", fontWeight: "900", color: "#0f172a", letterSpacing: "-0.03em", lineHeight: 1.1 }}>
                    {fmtM(stats.totalVal)}
                  </div>
                <div style={{ marginTop: "10px", fontSize: "14px", color: "#64748b", fontWeight: "700" }}>
                  Top 5 = {capitalTop5Percent.toFixed(1).replace('.', ',')}%
                </div>
                </div>

                {renderDonutChart({
                  pieData: stats.pieData,
                  hoveredName: hoveredSlice,
                  selectedName: selectedSlice,
                  onSliceClick: handleSliceClick,
                  onSliceHover: handleMouseMove,
                  onMouseLeave: () => { setTooltip({ show: false }); setHoveredSlice(null); },
                  donut: true,
                  size: 250
                })}

                <div style={{ marginTop: "20px", textAlign: "center", color: "#64748b", fontSize: "13px", lineHeight: 1.45, maxWidth: "320px" }}>
                  Passe o mouse para ver os detalhes e clique em um segmento para filtrar os títulos daquele {focus === 'cedente' ? 'cedente' : 'sacado'} na tabela detalhada.
                </div>
              </div>

              <div style={{
                flex: "1 1 520px",
                minWidth: "320px",
                border: "1px solid #d1d5db",
                borderRadius: "18px",
                overflow: "hidden",
                background: "#ffffff"
              }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 220px 120px", background: "#f3f4f6", color: "#526581", fontSize: "13px", fontWeight: "800", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid #d1d5db" }}>
                  <div style={{ padding: "16px 20px" }}>{focus === 'cedente' ? 'Cedente' : 'Sacado'}</div>
                  <div style={{ padding: "16px 20px", textAlign: "right" }}>Capital em Aberto</div>
                  <div style={{ padding: "16px 20px", textAlign: "right" }}>%</div>
                </div>
                {capitalPageItems.map((slice, idx) => {
                  const globalIndex = (capitalPageSafe - 1) * capitalItemsPerPage + idx;
                  const pieSlice = stats.pieData.find(item => item.name === slice.name);
                  const color = pieSlice?.color || '#94a3b8';
                  const isDimmed = selectedSlice && selectedSlice !== slice.name;
                  const isActive = selectedSlice === slice.name;
                  return (
                    <div
                      key={slice.name}
                      onClick={() => handleSliceClick(slice.name)}
                      onMouseEnter={() => setHoveredSlice(slice.name)}
                      onMouseLeave={() => setHoveredSlice(null)}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr) 220px 120px",
                        alignItems: "center",
                        borderBottom: globalIndex === capitalTableItems.length - 1 ? "none" : "1px solid #e5e7eb",
                        background: isActive ? "#eef2ff" : hoveredSlice === slice.name ? "#eff6ff" : "#fff",
                        opacity: isDimmed ? 0.35 : 1,
                        cursor: "pointer",
                        transition: "all 0.2s"
                      }}
                    >
                      <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                        <span style={{ width: "12px", height: "12px", borderRadius: "999px", background: color, flexShrink: 0 }} />
                        <span style={{ fontSize: "16px", fontWeight: "700", color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={slice.name}>{slice.name}</span>
                      </div>
                      <div style={{ padding: "16px 20px", textAlign: "right", fontSize: "16px", fontWeight: "800", color: "#0f172a" }}>{fmtM(slice.val)}</div>
                      <div style={{ padding: "16px 20px", textAlign: "right", fontSize: "16px", fontWeight: "800", color: "#475569" }}>{(slice.percent * 100).toFixed(2).replace('.', ',')}%</div>
                    </div>
                  );
                })}
                {capitalTableItems.length > capitalItemsPerPage && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '14px 16px', borderTop: '1px solid #e5e7eb', background: '#fff' }}>
                    <span style={{ fontSize: '13px', color: '#6b7280' }}>
                      Mostrando {(capitalPageSafe - 1) * capitalItemsPerPage + 1} a {Math.min(capitalPageSafe * capitalItemsPerPage, capitalTableItems.length)} de {capitalTableItems.length} entradas
                    </span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => setCapitalPage(p => Math.max(1, p - 1))}
                        disabled={capitalPageSafe === 1}
                        style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #d1d5db', background: capitalPageSafe === 1 ? '#f3f4f6' : '#fff', color: capitalPageSafe === 1 ? '#9ca3af' : '#374151', cursor: capitalPageSafe === 1 ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600 }}
                      >
                        Anterior
                      </button>
                      <button
                        onClick={() => setCapitalPage(p => Math.min(capitalTotalPages, p + 1))}
                        disabled={capitalPageSafe === capitalTotalPages}
                        style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #d1d5db', background: capitalPageSafe === capitalTotalPages ? '#f3f4f6' : '#fff', color: capitalPageSafe === capitalTotalPages ? '#9ca3af' : '#374151', cursor: capitalPageSafe === capitalTotalPages ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600 }}
                      >
                        Próxima
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* BANNER DE KPIs INTELIGENTE */}
          {kpiData.baseCalculo > 0 && (
            <div style={{
              background: "#d1d5db",
              borderRadius: "12px",
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: "1px",
              boxShadow: "0 8px 18px rgba(0, 0, 0, 0.08)",
              marginBottom: "32px",
              border: "1px solid #d1d5db",
              overflow: "hidden"
            }}>
              <div style={{ background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)", borderTop: "3px solid #7c3aed", padding: "20px 16px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                  <div style={{ background: "rgba(124, 58, 237, 0.1)", padding: "6px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="16" height="16" fill="none" stroke="#7c3aed" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H7"/></svg>
                  </div>
                  <h3 style={{ margin: 0, fontSize: "11px", fontWeight: "700", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "normal" }}>Risco Atual</h3>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
                  <span style={{ fontSize: "28px", fontWeight: "700", color: "#111827", lineHeight: "1", letterSpacing: "-0.02em", wordBreak: "break-word" }}>
                    {fmtM(kpiData.riscoAtual)}
                  </span>
                </div>
                <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "12px", fontWeight: "500", whiteSpace: "normal" }}>
                  Títulos em aberto na seleção
                </div>
              </div>

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

              <div style={{ background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)", borderTop: "3px solid #0ea5e9", padding: "20px 16px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                  <div style={{ background: "rgba(14, 165, 233, 0.1)", padding: "6px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="16" height="16" fill="none" stroke="#0ea5e9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                      <rect x="2" y="6" width="20" height="12" rx="2"></rect>
                      <circle cx="12" cy="12" r="2"></circle>
                      <path d="M6 12h.01M18 12h.01"></path>
                    </svg>
                  </div>
                  <h3 style={{ margin: 0, fontSize: "11px", fontWeight: "700", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "normal" }}>
                    Ticket Médio (Borderô)
                  </h3>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
                  <span style={{ fontSize: "28px", fontWeight: "700", color: "#111827", lineHeight: "1", letterSpacing: "-0.02em", wordBreak: "break-word" }}>
                    {fmtM(kpiData.valorMedioBordero)}
                  </span>
                </div>
                <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "12px", fontWeight: "500", whiteSpace: "normal" }}>
                  Borderôs analisados: <span style={{ color: "#374151", fontWeight: "600" }}>{kpiData.qtdBorderos}</span>
                </div>
              </div>

              <div style={{ background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)", borderTop: "3px solid #06b6d4", padding: "20px 16px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                  <div style={{ background: "rgba(6, 182, 212, 0.1)", padding: "6px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="16" height="16" fill="none" stroke="#06b6d4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                      <path d="M3 7h18"></path>
                      <path d="M6 3v8"></path>
                      <path d="M18 3v8"></path>
                      <rect x="3" y="11" width="18" height="10" rx="2"></rect>
                    </svg>
                  </div>
                  <h3 style={{ margin: 0, fontSize: "11px", fontWeight: "700", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "normal" }}>
                    Ticket Médio (Título)
                  </h3>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
                  <span style={{ fontSize: "28px", fontWeight: "700", color: "#111827", lineHeight: "1", letterSpacing: "-0.02em", wordBreak: "break-word" }}>
                    {fmtM(kpiData.valorMedioTitulo)}
                  </span>
                </div>
                <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "12px", fontWeight: "500", whiteSpace: "normal" }}>
                  Títulos analisados: <span style={{ color: "#374151", fontWeight: "600" }}>{kpiData.qtdTitulos}</span>
                </div>
              </div>

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

          {/* Troca Dinâmica de Tabelas */}
          {detailedRows ? (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <div>
                  <h3 style={{ margin: "0 0 4px 0", color: "#111827", fontSize: "18px" }}>
                    Títulos em Aberto de: <span style={{ color: "#4f46e5" }}>{selectedSlice}</span>
                  </h3>
                  <div style={{ fontSize: "13px", color: "#6b7280" }}>
                    <strong>{detailedRows.length}</strong> registo(s) encontrado(s) totalizando <strong>{fmtM(detailedRows.reduce((acc, row) => { const vk = Object.keys(row).find(k => k.toLowerCase() === 'entrada' || k.toLowerCase().includes('valor')); return acc + (vk ? Number(row[vk]) || 0 : 0) }, 0))}</strong>
                  </div>
                </div>
                <button onClick={() => setSelectedSlice(null)} className="btn-voltar">
                  Voltar ao Ranking
                </button>
              </div>
              <MacroDetailedTable rows={detailedRows} focus={focus} setFocus={setFocus} setSelectedSlice={setSelectedSlice} hideValues={hideValues} />
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
                        className={`ranking-row ${idx % 2 === 0 ? 'ranking-row-even' : 'ranking-row-odd'}`}
                        title="Clique para ver os títulos detalhados"
                      >
                        <td style={{ padding: "14px 16px", fontWeight: "600", color: "#6b7280" }}>{item.rank}º</td>
                        <td style={{ padding: "14px 16px", fontWeight: "600", color: "#4f46e5" }}>{item.name}</td>
                        <td style={{ padding: "14px 16px", fontWeight: "600", color: item.hasVar ? (item.varPct > 0 ? "#10b981" : item.varPct < 0 ? "#ef4444" : "#6b7280") : "#9ca3af" }}>
                          {item.hasVar ? `${item.varPct > 0 ? '+' : ''}${item.varPct.toFixed(1).replace('.', ',')}%` : '-'}
                        </td>
                        <td style={{ padding: "14px 16px", color: "#4b5563" }}>{item.count}</td>
                        <td style={{ padding: "14px 16px", fontWeight: "700", color: "#059669" }}>{fmtM(item.val)}</td>
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
        <div style={{ position: 'fixed', top: tooltip.y + 15, left: tooltip.x + 15, background: 'rgba(17, 24, 39, 0.96)', color: '#fff', padding: '12px 16px', borderRadius: '10px', pointerEvents: 'none', zIndex: 9999, boxShadow: '0 10px 15px -3px rgba(0,0,0,0.3)' }}>
          <div style={{ fontWeight: 700, fontSize: "14px", color: '#f3f4f6', marginBottom: "4px" }}>{tooltip.label}</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#10b981' }}>{fmtM(tooltip.value)}</div>
          <div style={{ marginTop: '2px', fontSize: '13px', color: '#9ca3af' }}>
            {tooltip.context === 'volume_negociado'
              ? `Representa ${(tooltip.percent * 100).toFixed(1)}% do volume negociado no período`
              : tooltip.context === 'des_enc_negociado'
                ? `Representa ${(tooltip.percent * 100).toFixed(1)}% do total de Enc. + Des. no período`
                : `Representa ${(tooltip.percent * 100).toFixed(1)}% do capital em aberto`}
          </div>
          {tooltip.context !== 'volume_negociado' && tooltip.context !== 'des_enc_negociado' && (
            <div style={{ marginTop: '6px', fontSize: '11px', color: '#60a5fa', fontStyle: 'italic' }}>Clique para ver os detalhes</div>
          )}
        </div>
      )}
    </div>
  );
}