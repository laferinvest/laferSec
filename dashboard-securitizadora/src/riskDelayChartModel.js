export const HISTORY_DAY_MS = 86400000;
export const historyTimestamp = (day) => Date.parse(`${day}T12:00:00Z`);

export function historyDaySpan(rows) {
  return rows.length ? Math.round((historyTimestamp(rows.at(-1).data_referencia) - historyTimestamp(rows[0].data_referencia)) / HISTORY_DAY_MS) + 1 : 0;
}

export function historyPointInterval(days) {
  if (days <= 30) return 1;
  if (days <= 60) return 2;
  if (days <= 90) return 3;
  return Math.ceil(days / 30);
}

// Espaça por dias de calendário, preservando registros reais e os extremos.
export function spacedHistoryRows(rows, interval) {
  if (rows.length < 2) return [...rows];
  const spaced = [rows[0]];
  const distance = (a, b) => (historyTimestamp(b.data_referencia) - historyTimestamp(a.data_referencia)) / HISTORY_DAY_MS;
  for (const row of rows.slice(1, -1)) {
    if (distance(spaced.at(-1), row) >= interval) spaced.push(row);
  }
  const last = rows.at(-1);
  if (spaced.length > 1 && distance(spaced.at(-1), last) < interval) spaced.pop();
  spaced.push(last);
  return spaced;
}

export function historyMarkerRows(rows, interval) {
  const markers = [];
  let segment = [];
  const appendSegment = () => { markers.push(...spacedHistoryRows(segment, interval)); segment = []; };
  for (const row of rows) {
    if (row.percentual_atraso === null) appendSegment();
    else segment.push(row);
  }
  appendSegment();
  return markers;
}
