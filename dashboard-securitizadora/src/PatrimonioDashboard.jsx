import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

function formatarMoeda(valor, hideValues = false) {
  if (hideValues) return "R$ -";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(valor || 0));
}

function formatarPct(valor, hideValues = false) {
  if (hideValues) return "-";
  return `${Number(valor || 0).toFixed(2).replace(".", ",")}%`;
}

function formatarDataLabel(dataIso) {
  if (!dataIso) return "";
  const [y, m, d] = String(dataIso).split("-");
  return `${d}/${m}/${y}`;
}

function formatarMesCurto(dataIso) {
  if (!dataIso) return "";
  const [y, m] = String(dataIso).split("-");
  const meses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${meses[Number(m) - 1]}/${y}`;
}

function normalizeSnapshot(row) {
  const data = row.Data || row.data || null;
  const recebiveis = Number(row["Recebiveis"] ?? row.recebiveis ?? 0);
  const dinheiroBanco = Number(row["Dinheiro Banco"] ?? row.dinheiro_banco ?? row.dinheiroBanco ?? 0);
  const compraDebentures = Number(row["Compra Debentures"] ?? row.compra_debentures ?? row.compraDebentures ?? 0);

  return {
    data,
    recebiveis,
    dinheiroBanco,
    compraDebentures,
    pl: recebiveis + dinheiroBanco,
  };
}

function agruparPorMesUltimoSnapshot(rows) {
  const mapa = new Map();

  for (const row of rows) {
    const ym = String(row.data).slice(0, 7);
    if (!mapa.has(ym) || row.data > mapa.get(ym).data) {
      mapa.set(ym, row);
    }
  }

  return Array.from(mapa.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, value]) => value);
}

function buildPath(points) {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

function useViewport() {
  const [width, setWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1200
  );

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return {
    width,
    isMobile: width < 640,
    isTablet: width >= 640 && width < 1024,
  };
}

function LineChart({
  title,
  subtitle,
  data,
  valueKey,
  color,
  hideValues = false,
  formatter = (v) => String(v),
  axisFormatter = (v) => String(v),
  xLabelFormatter,
  isMobile = false,
  includeZero = true,
  hideSummaryBoxes = false,
  customSummaryBoxes = null,
  hoveredKey = null,
  onHoverChange = null,
  hoverKeyField = "data",
  hoverSource = "daily",
  onRangeSelect = null,
  selectedStartKey = null,
  selectedEndKey = null,
}) {
  const [dragState, setDragState] = useState({
    isDragging: false,
    startIndex: null,
    currentIndex: null,
  });

  if (!data || data.length === 0) {
    return (
      <div style={chartBoxStyle}>
        <h3 style={chartTitleStyle}>{title}</h3>
        <p style={chartSubtitleStyle}>{subtitle}</p>
        <div style={{ color: "#6b7280", fontSize: 14 }}>Sem dados suficientes.</div>
      </div>
    );
  }

  const hoveredIndex = useMemo(() => {
    if (!hoveredKey) return null;
    const idx = data.findIndex((item) => item[hoverKeyField] === hoveredKey);
    return idx >= 0 ? idx : null;
  }, [data, hoveredKey, hoverKeyField]);

  useEffect(() => {
    const handleMouseUp = () => {
      if (!dragState.isDragging) return;

      const minIdx = Math.min(dragState.startIndex, dragState.currentIndex);
      const maxIdx = Math.max(dragState.startIndex, dragState.currentIndex);

      const startPoint = data[minIdx];
      const endPoint = data[maxIdx];

      if (startPoint && endPoint && onRangeSelect) {
        onRangeSelect({
          start: startPoint[hoverKeyField],
          end: endPoint[hoverKeyField],
          source: hoverSource,
        });
      }

      setDragState({
        isDragging: false,
        startIndex: null,
        currentIndex: null,
      });
    };

    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [dragState, data, hoverKeyField, hoverSource, onRangeSelect]);

  const svgWidth = 520;
  const svgHeight = isMobile ? 235 : 260;
  const paddingLeft = isMobile ? 42 : 52;
  const paddingRight = isMobile ? 12 : 20;
  const paddingTop = 20;
  const paddingBottom = isMobile ? 68 : 78;
  const chartWidth = svgWidth - paddingLeft - paddingRight;
  const chartHeight = svgHeight - paddingTop - paddingBottom;

  const values = data.map((d) => Number(d[valueKey] || 0));
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);

  let safeMin = minVal;
  let safeMax = maxVal;

  if (minVal === maxVal) {
    safeMin = minVal - 1;
    safeMax = maxVal + 1;
  }

  if (includeZero) {
    if (minVal > 0) safeMin = 0;
    if (maxVal < 0) safeMax = 0;
  } else {
    const dynamicPadding = Math.max((maxVal - minVal) * 0.12, Math.abs(maxVal || 1) * 0.02);
    safeMin = minVal - dynamicPadding;
    safeMax = maxVal + dynamicPadding;
  }

  const range = safeMax - safeMin || 1;

  const points = data.map((d, i) => {
    const x =
      data.length === 1
        ? paddingLeft + chartWidth / 2
        : paddingLeft + (i / (data.length - 1)) * chartWidth;

    const y = paddingTop + ((safeMax - Number(d[valueKey] || 0)) / range) * chartHeight;

    return {
      ...d,
      x,
      y,
      value: Number(d[valueKey] || 0),
    };
  });

  const pathD = buildPath(points);
  const step = Math.max(1, Math.ceil(data.length / (isMobile ? 4 : 6)));
  const segmentWidth = data.length > 1 ? chartWidth / (data.length - 1) : chartWidth;

  const yTicks = [
    safeMin,
    safeMin + range * 0.25,
    safeMin + range * 0.5,
    safeMin + range * 0.75,
    safeMax,
  ];

  const zeroY =
    includeZero && safeMin <= 0 && safeMax >= 0
      ? paddingTop + ((safeMax - 0) / range) * chartHeight
      : null;

  const defaultBoxes = [
    { label: "Início", value: formatter(points[0].value) },
    { label: "Fim", value: formatter(points[points.length - 1].value) },
    { label: "Variação", value: formatter(points[points.length - 1].value - points[0].value) },
  ];

  const boxes = customSummaryBoxes || defaultBoxes;
  const hoveredPoint = hoveredIndex !== null ? points[hoveredIndex] : null;

  const selectedIndexes = useMemo(() => {
    if (dragState.isDragging) {
      const minIdx = Math.min(dragState.startIndex, dragState.currentIndex);
      const maxIdx = Math.max(dragState.startIndex, dragState.currentIndex);
      return { minIdx, maxIdx };
    }

    if (selectedStartKey && selectedEndKey) {
      const startIdx = data.findIndex((item) => item[hoverKeyField] === selectedStartKey);
      const endIdx = data.findIndex((item) => item[hoverKeyField] === selectedEndKey);
      if (startIdx >= 0 && endIdx >= 0) {
        return {
          minIdx: Math.min(startIdx, endIdx),
          maxIdx: Math.max(startIdx, endIdx),
        };
      }
    }

    return null;
  }, [dragState, data, hoverKeyField, selectedStartKey, selectedEndKey]);

const renderSelectionHighlight = () => {
  if (!dragState.isDragging || !selectedIndexes) return null;

  const { minIdx, maxIdx } = selectedIndexes;
  const startPoint = points[minIdx];
  const endPoint = points[maxIdx];
  if (!startPoint || !endPoint) return null;

  const xStart = Math.max(paddingLeft, startPoint.x - segmentWidth / 2);
  const xEnd = Math.min(svgWidth - paddingRight, endPoint.x + segmentWidth / 2);

  return (
    <rect
      x={xStart}
      y={paddingTop}
      width={Math.max(0, xEnd - xStart)}
      height={chartHeight}
      fill={`color-mix(in srgb, ${color} 12%, transparent)`}
      stroke={`color-mix(in srgb, ${color} 45%, transparent)`}
      strokeWidth="1"
      pointerEvents="none"
    />
  );
};

const renderOutsideSelectionMask = () => {
  if (dragState.isDragging || !selectedIndexes) return null;

  const { minIdx, maxIdx } = selectedIndexes;
  const startPoint = points[minIdx];
  const endPoint = points[maxIdx];
  if (!startPoint || !endPoint) return null;

  const xStart = Math.max(paddingLeft, startPoint.x - segmentWidth / 2);
  const xEnd = Math.min(svgWidth - paddingRight, endPoint.x + segmentWidth / 2);

  return (
    <>
      <rect
        x={paddingLeft}
        y={paddingTop}
        width={Math.max(0, xStart - paddingLeft)}
        height={chartHeight}
        fill="rgba(255,255,255,0.72)"
        pointerEvents="none"
      />
      <rect
        x={xEnd}
        y={paddingTop}
        width={Math.max(0, (svgWidth - paddingRight) - xEnd)}
        height={chartHeight}
        fill="rgba(255,255,255,0.72)"
        pointerEvents="none"
      />
    </>
  );
};

  return (
    <div style={chartBoxStyle}>
      <h3 style={chartTitleStyle}>{title}</h3>
      <p style={chartSubtitleStyle}>{subtitle}</p>

      <div style={{ width: "100%", overflow: "hidden" }}>
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
          onMouseLeave={() => onHoverChange?.({ source: null, key: null })}
        >
          <defs>
            <linearGradient id={`grad-${title.replace(/\s+/g, "-")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {renderSelectionHighlight()}
          {renderOutsideSelectionMask()}

          {yTicks.map((tick, i) => {
            const y = paddingTop + ((safeMax - tick) / range) * chartHeight;
            return (
              <g key={i}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={svgWidth - paddingRight}
                  y2={y}
                  stroke="#eef2f7"
                  strokeWidth="1"
                />
                <text
                  x={paddingLeft - 6}
                  y={y + 4}
                  fill="#9ca3af"
                  fontSize={isMobile ? "9" : "10"}
                  textAnchor="end"
                >
                  {hideValues ? "-" : axisFormatter(tick)}
                </text>
              </g>
            );
          })}

          {zeroY !== null && (
            <line
              x1={paddingLeft}
              y1={zeroY}
              x2={svgWidth - paddingRight}
              y2={zeroY}
              stroke="#cbd5e1"
              strokeWidth="1.2"
              strokeDasharray="4 4"
            />
          )}

          <path
            d={`${pathD} L ${points[points.length - 1].x} ${paddingTop + chartHeight} L ${points[0].x} ${paddingTop + chartHeight} Z`}
            fill={`url(#grad-${title.replace(/\s+/g, "-")})`}
          />

          <path
            d={pathD}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={hoveredIndex === i ? (isMobile ? "4.2" : "4.8") : isMobile ? "3.2" : "3.8"}
              fill="#fff"
              stroke={color}
              strokeWidth="2"
            />
          ))}

          {hoveredPoint && (() => {
            const tooltipWidth = 138;
            const tooltipHeight = 42;
            const rectX = Math.max(8, Math.min(svgWidth - tooltipWidth - 8, hoveredPoint.x - tooltipWidth / 2));
            const rectY = Math.max(4, hoveredPoint.y - 52);

            return (
              <g pointerEvents="none">
                <line
                  x1={hoveredPoint.x}
                  y1={paddingTop}
                  x2={hoveredPoint.x}
                  y2={paddingTop + chartHeight}
                  stroke="#94a3b8"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                />
                <circle
                  cx={hoveredPoint.x}
                  cy={hoveredPoint.y}
                  r={isMobile ? "4.6" : "5.2"}
                  fill="#fff"
                  stroke={color}
                  strokeWidth="2.2"
                />
                <rect
                  x={rectX}
                  y={rectY}
                  width={tooltipWidth}
                  height={tooltipHeight}
                  rx="6"
                  fill="#111827"
                  opacity="0.96"
                />
                <text
                  x={rectX + tooltipWidth / 2}
                  y={rectY + 15}
                  fill="#cbd5e1"
                  fontSize="10"
                  fontWeight="600"
                  textAnchor="middle"
                >
                  {formatarDataLabel(hoveredPoint.data)}
                </text>
                <text
                  x={rectX + tooltipWidth / 2}
                  y={rectY + 31}
                  fill="#fff"
                  fontSize="11"
                  fontWeight="700"
                  textAnchor="middle"
                >
                  {formatter(hoveredPoint.value)}
                </text>
              </g>
            );
          })()}

          {points.map((p, i) => {
            if (i % step !== 0 && i !== points.length - 1) return null;
            const label = xLabelFormatter ? xLabelFormatter(p.data) : formatarMesCurto(p.data);

            return (
              <text
                key={`x-${i}`}
                x={p.x}
                y={svgHeight - 28}
                fill="#6b7280"
                fontSize={isMobile ? "9" : "10"}
                textAnchor="end"
                transform={`rotate(-35, ${p.x}, ${svgHeight - 28})`}
              >
                {label}
              </text>
            );
          })}

          {points.map((p, i) => (
            <rect
              key={`hover-${i}`}
              x={Math.max(paddingLeft, p.x - segmentWidth / 2)}
              y={paddingTop}
              width={Math.min(segmentWidth, svgWidth - paddingRight - Math.max(paddingLeft, p.x - segmentWidth / 2))}
              height={chartHeight}
              fill="transparent"
              onMouseDown={(e) => {
                e.preventDefault();
                setDragState({
                  isDragging: true,
                  startIndex: i,
                  currentIndex: i,
                });
                onHoverChange?.({ source: hoverSource, key: p[hoverKeyField] });
              }}
              onMouseEnter={() => {
                onHoverChange?.({ source: hoverSource, key: p[hoverKeyField] });
                if (dragState.isDragging) {
                  setDragState((prev) => ({ ...prev, currentIndex: i }));
                }
              }}
              onMouseMove={() => {
                onHoverChange?.({ source: hoverSource, key: p[hoverKeyField] });
                if (dragState.isDragging) {
                  setDragState((prev) => ({ ...prev, currentIndex: i }));
                }
              }}
              style={{ cursor: "crosshair" }}
            />
          ))}
        </svg>
      </div>

      {!hideSummaryBoxes && (
        <div
          style={{
            marginTop: 12,
            display: "grid",
            gridTemplateColumns: isMobile
              ? "1fr"
              : `repeat(${Math.max(1, boxes.length)}, minmax(0, 1fr))`,
            gap: 8,
          }}
        >
          {boxes.map((box, idx) => (
            <div key={idx} style={miniCardStyle}>
              <div style={miniLabelStyle}>{box.label}</div>
              <div style={miniValueStyle}>{box.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const pageCardStyle = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: "12px",
  padding: "24px",
  boxShadow: "0 8px 20px rgba(0,0,0,0.06)",
  boxSizing: "border-box",
  minWidth: 0,
};

const chartBoxStyle = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: "12px",
  padding: "16px",
  boxShadow: "0 8px 20px rgba(0,0,0,0.06)",
  boxSizing: "border-box",
  minWidth: 0,
  width: "100%",
};

const chartTitleStyle = {
  margin: "0 0 6px 0",
  color: "#111827",
  fontSize: "15px",
  fontWeight: "700",
};

const chartSubtitleStyle = {
  margin: "0 0 14px 0",
  color: "#6b7280",
  fontSize: "12px",
  lineHeight: 1.4,
};

const miniCardStyle = {
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: "8px",
  padding: "10px 12px",
  minWidth: 0,
  boxSizing: "border-box",
};

const miniLabelStyle = {
  fontSize: "10px",
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  fontWeight: "700",
  marginBottom: 4,
};

const miniValueStyle = {
  fontSize: "13px",
  color: "#111827",
  fontWeight: "700",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid #d1d5db",
  fontSize: "14px",
  background: "#fff",
  outline: "none",
  boxSizing: "border-box",
};

export default function PatrimonioDashboard({ hideValues, setHideValues }) {
  const { isMobile, isTablet } = useViewport();

  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [rows, setRows] = useState([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [hoverState, setHoverState] = useState({
    source: null, // "daily" | "monthly" | null
    key: null,
  });

  useEffect(() => {
    carregar();
  }, []);

  async function carregar() {
    setLoading(true);
    setErro("");

    try {
      const { data, error } = await supabase
        .from("secSnapshots")
        .select("*")
        .order("Data", { ascending: true });

      if (error) throw error;

      const normalizados = (data || [])
        .map(normalizeSnapshot)
        .filter((r) => r.data);

      setRows(normalizados);

      if (normalizados.length > 0) {
        setStartDate(normalizados[0].data);
        setEndDate(normalizados[normalizados.length - 1].data);
      }
    } catch (err) {
      console.error(err);
      setErro(`Erro ao carregar snapshots: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (startDate && r.data < startDate) return false;
      if (endDate && r.data > endDate) return false;
      return true;
    });
  }, [rows, startDate, endDate]);

  const seriesDiaria = useMemo(() => {
    if (!filteredRows.length) return [];

    let twrIndex = 1;
    let prevPL = null;

    return filteredRows.map((r, idx) => {
      let periodReturn = 0;

      if (idx === 0 || prevPL === null || prevPL <= 0) {
        periodReturn = 0;
      } else {
        periodReturn = (r.pl - (r.compraDebentures || 0)) / prevPL - 1;
      }

      twrIndex *= 1 + periodReturn;

      const retornoAcumuladoPct = (twrIndex - 1) * 100;

      prevPL = r.pl;

      return {
        ...r,
        periodReturn,
        retornoAcumuladoPct,
      };
    });
  }, [filteredRows]);

  const seriesMensal = useMemo(() => {
    const mensal = agruparPorMesUltimoSnapshot(filteredRows);
    if (!mensal.length) return [];

    let prevPL = null;

    return mensal.map((r, idx) => {
      let retornoMesPct = 0;

      if (idx === 0 || prevPL === null || prevPL <= 0) {
        retornoMesPct = 0;
      } else {
        retornoMesPct = (((r.pl - (r.compraDebentures || 0)) / prevPL) - 1) * 100;
      }

      prevPL = r.pl;

      return {
        ...r,
        retornoMesPct,
      };
    });
  }, [filteredRows]);

  const resumo = useMemo(() => {
    if (!seriesDiaria.length) {
      return {
        plAtual: 0,
        retornoPct: 0,
        recebiveisAtual: 0,
        caixaAtual: 0,
      };
    }

    const last = seriesDiaria[seriesDiaria.length - 1];
    return {
      plAtual: last.pl,
      retornoPct: last.retornoAcumuladoPct,
      recebiveisAtual: last.recebiveis,
      caixaAtual: last.dinheiroBanco,
    };
  }, [seriesDiaria]);

  const metricasMensais = useMemo(() => {
    if (!seriesMensal.length) {
      return {
        retornoMedio: 0,
        pctMesesAcima3: 0,
        retornoMedio3M: 0,
      };
    }

    const retornos = seriesMensal.map((r) => Number(r.retornoMesPct || 0));
    const retornoMedio = retornos.reduce((acc, v) => acc + v, 0) / retornos.length;

    const mesesAcima3 = retornos.filter((v) => v > 3).length;
    const pctMesesAcima3 = (mesesAcima3 / retornos.length) * 100;

    const ultimos3 = retornos.slice(-3);
    const retornoMedio3M =
      ultimos3.length > 0
        ? ultimos3.reduce((acc, v) => acc + v, 0) / ultimos3.length
        : 0;

    return {
      retornoMedio,
      pctMesesAcima3,
      retornoMedio3M,
    };
  }, [seriesMensal]);

  const retornoMensalMap = useMemo(() => {
    const map = new Map();
    for (const r of seriesMensal) {
      map.set(r.data, r.retornoMesPct);
    }
    return map;
  }, [seriesMensal]);

  const hoveredDataKey = useMemo(() => {
  if (!hoverState.key) return null;

  if (hoverState.source === "daily") {
    return hoverState.key;
  }

  if (hoverState.source === "monthly") {
    const ym = String(hoverState.key).slice(0, 7);
    const rowDiaria = [...seriesDiaria]
      .reverse()
      .find((r) => String(r.data).slice(0, 7) === ym);

    return rowDiaria ? rowDiaria.data : null;
  }

  return null;
}, [hoverState, seriesDiaria]);

const hoveredMonthKey = useMemo(() => {
  if (!hoverState.key) return null;

  if (hoverState.source === "monthly") {
    return hoverState.key;
  }

  if (hoverState.source === "daily") {
    const ym = String(hoverState.key).slice(0, 7);
    const rowMensal = seriesMensal.find((r) => String(r.data).slice(0, 7) === ym);

    return rowMensal ? rowMensal.data : null;
  }

  return null;
}, [hoverState, seriesMensal]);

const handleChartRangeSelect = useCallback(({ start, end, source }) => {
  if (!start || !end) return;

  let nextStart = start;
  let nextEnd = end;

  if (source === "monthly") {
    const startMonthRow = seriesMensal.find((r) => r.data === start);
    const endMonthRow = seriesMensal.find((r) => r.data === end);

    if (startMonthRow) nextStart = startMonthRow.data;
    if (endMonthRow) nextEnd = endMonthRow.data;
  }

  const finalStart = nextStart <= nextEnd ? nextStart : nextEnd;
  const finalEnd = nextStart <= nextEnd ? nextEnd : nextStart;

  if (startDate === finalStart && endDate === finalEnd) {
    if (rows.length > 0) {
      setStartDate(rows[0].data);
      setEndDate(rows[rows.length - 1].data);
    }
  } else {
    setStartDate(finalStart);
    setEndDate(finalEnd);
  }
}, [seriesMensal, startDate, endDate, rows]);

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "1400px",
        margin: "0 auto",
        overflowX: "hidden",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "grid", gap: isMobile ? "16px" : "24px" }}>
        <div
          style={{
            ...pageCardStyle,
            padding: isMobile ? "16px" : "24px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div style={{ minWidth: 0, flex: "1 1 300px" }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: isMobile ? "20px" : "22px",
                  color: "#111827",
                  fontWeight: "800",
                }}
              >
                Patrimônio
              </h2>
              <p
                style={{
                  margin: "8px 0 0 0",
                  color: "#6b7280",
                  fontSize: isMobile ? 13 : 14,
                  lineHeight: 1.45,
                }}
              >
                PL = Recebíveis + Dinheiro Banco. Retornos percentuais removem o fluxo externo de compra de debêntures.
              </p>
            </div>

            <button
              onClick={() => setHideValues(!hideValues)}
              style={{
                width: isMobile ? "100%" : "auto",
                padding: "10px 14px",
                borderRadius: "8px",
                border: "1px solid #d1d5db",
                background: "#fff",
                color: "#374151",
                fontSize: "14px",
                fontWeight: "600",
                cursor: "pointer",
                boxSizing: "border-box",
              }}
            >
              {hideValues ? "Mostrar valores" : "Ocultar valores"}
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile
                ? "1fr"
                : "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 16,
              marginTop: 20,
            }}
          >
            <div style={miniCardStyle}>
              <div style={miniLabelStyle}>PL Atual</div>
              <div style={{ ...miniValueStyle, fontSize: isMobile ? 18 : 20 }}>
                {formatarMoeda(resumo.plAtual, hideValues)}
              </div>
            </div>
            <div style={miniCardStyle}>
              <div style={miniLabelStyle}>Recebíveis</div>
              <div style={{ ...miniValueStyle, fontSize: isMobile ? 15 : 16 }}>
                {formatarMoeda(resumo.recebiveisAtual, hideValues)}
              </div>
            </div>
            <div style={miniCardStyle}>
              <div style={miniLabelStyle}>Dinheiro Banco</div>
              <div style={{ ...miniValueStyle, fontSize: isMobile ? 15 : 16 }}>
                {formatarMoeda(resumo.caixaAtual, hideValues)}
              </div>
            </div>
            <div style={miniCardStyle}>
              <div style={miniLabelStyle}>Retorno Acum. TWR</div>
              <div style={{ ...miniValueStyle, fontSize: isMobile ? 15 : 16 }}>
                {formatarPct(resumo.retornoPct, hideValues)}
              </div>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : isTablet ? "1fr 1fr" : "repeat(3, minmax(0, 220px))",
              gap: 12,
              marginTop: 20,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
                Data inicial
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div style={{ minWidth: 0 }}>
              <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
                Data final
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div style={{ display: "flex", alignItems: "flex-end", minWidth: 0 }}>
              <button
                onClick={carregar}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "0",
                  background: "#4f46e5",
                  color: "#fff",
                  fontSize: "14px",
                  fontWeight: "700",
                  cursor: "pointer",
                  boxSizing: "border-box",
                }}
              >
                Recarregar
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ ...pageCardStyle, padding: isMobile ? "16px" : "24px" }}>
            Carregando patrimônio...
          </div>
        ) : erro ? (
          <div
            style={{
              ...pageCardStyle,
              padding: isMobile ? "16px" : "24px",
              color: "#991b1b",
              background: "#fef2f2",
              border: "1px solid #fecaca",
            }}
          >
            {erro}
          </div>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
                gap: isMobile ? "16px" : "24px",
                alignItems: "stretch",
              }}
            >
              <LineChart
                title="PL monetário"
                subtitle="Soma de recebíveis e caixa."
                data={seriesDiaria}
                valueKey="pl"
                color="#4f46e5"
                hideValues={hideValues}
                isMobile={isMobile}
                includeZero={false}
                hoveredKey={hoveredDataKey}
                onHoverChange={setHoverState}
                hoverKeyField="data"
                hoverSource="daily"
                onRangeSelect={handleChartRangeSelect}
                selectedStartKey={startDate}
                selectedEndKey={endDate}
                formatter={(v) => formatarMoeda(v, hideValues)}
                axisFormatter={(v) => {
                  if (hideValues) return "-";
                  if (Math.abs(v) >= 1000000) return `${(v / 1000000).toFixed(2).replace(".", ",")}M`;
                  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(0)}k`;
                  return `${Math.round(v)}`;
                }}
                xLabelFormatter={(d) => formatarMesCurto(d)}
              />

              <LineChart
                title="Retorno acumulado"
                subtitle="TWR acumulado do período."
                data={seriesDiaria}
                valueKey="retornoAcumuladoPct"
                color="#10b981"
                hideValues={hideValues}
                isMobile={isMobile}
                hideSummaryBoxes={true}
                hoveredKey={hoveredDataKey}
                onHoverChange={setHoverState}
                hoverKeyField="data"
                hoverSource="daily"
                onRangeSelect={handleChartRangeSelect}
                selectedStartKey={startDate}
                selectedEndKey={endDate}
                formatter={(v) => formatarPct(v, hideValues)}
                axisFormatter={(v) => {
                  if (hideValues) return "-";
                  return `${Number(v).toFixed(1).replace(".", ",")}%`;
                }}
                xLabelFormatter={(d) => formatarMesCurto(d)}
              />

              <LineChart
                title="Retorno mês a mês"
                subtitle="Percentual mensal sem efeito do aporte externo."
                data={seriesMensal}
                valueKey="retornoMesPct"
                color="#f59e0b"
                hideValues={hideValues}
                isMobile={isMobile}
                hoveredKey={hoveredMonthKey}
                onHoverChange={setHoverState}
                hoverKeyField="data"
                hoverSource="monthly"
                onRangeSelect={handleChartRangeSelect}
                selectedStartKey={startDate}
                selectedEndKey={endDate}
                customSummaryBoxes={[
                  {
                    label: "Retorno médio",
                    value: formatarPct(metricasMensais.retornoMedio, hideValues),
                  },
                  {
                    label: "% meses > 3%",
                    value: formatarPct(metricasMensais.pctMesesAcima3, hideValues),
                  },
                  {
                    label: "Média últimos 3 meses",
                    value: formatarPct(metricasMensais.retornoMedio3M, hideValues),
                  },
                ]}
                formatter={(v) => formatarPct(v, hideValues)}
                axisFormatter={(v) => {
                  if (hideValues) return "-";
                  return `${Number(v).toFixed(1).replace(".", ",")}%`;
                }}
                xLabelFormatter={(d) => formatarMesCurto(d)}
              />
            </div>

            <div
              style={{
                ...pageCardStyle,
                padding: isMobile ? "16px" : "24px",
              }}
            >
              <h3
                style={{
                  margin: "0 0 16px 0",
                  color: "#111827",
                  fontSize: isMobile ? 15 : 16,
                  fontWeight: 700,
                }}
              >
                Últimos snapshots
              </h3>

              <div style={{ overflowX: "auto", width: "100%" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 920 }}>
                  <thead>
                    <tr style={{ background: "#f9fafb" }}>
                      <th style={thStyle}>Data</th>
                      <th style={thStyle}>Recebíveis</th>
                      <th style={thStyle}>Dinheiro Banco</th>
                      <th style={thStyle}>Compra Debêntures</th>
                      <th style={thStyle}>PL</th>
                      <th style={thStyle}>Retorno Mês</th>
                      <th style={thStyle}>Retorno Acum. TWR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...seriesDiaria].reverse().map((r) => (
                      <tr key={r.data} style={{ borderTop: "1px solid #f1f5f9" }}>
                        <td style={tdStyle}>{formatarDataLabel(r.data)}</td>
                        <td style={tdStyle}>{formatarMoeda(r.recebiveis, hideValues)}</td>
                        <td style={tdStyle}>{formatarMoeda(r.dinheiroBanco, hideValues)}</td>
                        <td style={tdStyle}>{formatarMoeda(r.compraDebentures, hideValues)}</td>
                        <td style={{ ...tdStyle, fontWeight: 700 }}>{formatarMoeda(r.pl, hideValues)}</td>
                        <td
                          style={{
                            ...tdStyle,
                            fontWeight: 700,
                            color: (() => {
                              const val = retornoMensalMap.get(r.data);
                              if (val == null) return "#374151";
                              return val < 3 ? "#dc2626" : "#16a34a"; // vermelho <3%, verde >=3%
                            })(),
                          }}
                        >
                          {retornoMensalMap.has(r.data)
                            ? formatarPct(retornoMensalMap.get(r.data), hideValues)
                            : "-"}
                        </td>
                        <td style={{ ...tdStyle, fontWeight: 700 }}>{formatarPct(r.retornoAcumuladoPct, hideValues)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const thStyle = {
  textAlign: "left",
  padding: "12px 14px",
  fontSize: "12px",
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  fontWeight: "700",
  whiteSpace: "nowrap",
};

const tdStyle = {
  padding: "12px 14px",
  fontSize: "14px",
  color: "#374151",
  whiteSpace: "nowrap",
};
