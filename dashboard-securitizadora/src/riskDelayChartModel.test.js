import test from "node:test";
import assert from "node:assert/strict";
import { HISTORY_DAY_MS, historyDaySpan, historyMarkerRows, historyPointInterval, spacedHistoryRows } from "./riskDelayChartModel.js";

const row = (day, ratio = 0.1) => ({ data_referencia: new Date(Date.UTC(2026, 0, 1) + day * HISTORY_DAY_MS).toISOString().slice(0, 10), percentual_atraso: ratio });
const daily = (days) => Array.from({ length: days }, (_, day) => row(day));

test("frequência muda nos limites de 30, 60 e 90 dias e limita históricos longos", () => {
  for (const [days, expected] of [[1, 1], [30, 1], [31, 2], [60, 2], [61, 3], [90, 3], [91, 4], [365, 13], [730, 25]]) {
    assert.equal(historyPointInterval(days), expected);
    const rows = daily(days);
    assert.equal(historyDaySpan(rows), days);
    const markers = historyMarkerRows(rows, historyPointInterval(days));
    assert.equal(markers[0], rows[0]);
    assert.equal(markers.at(-1), rows.at(-1));
    assert.ok(markers.length <= 31);
  }
  assert.equal(historyMarkerRows(daily(30), 1).length, 30);
});

test("espaçamento usa calendário sem inventar registros em dias sem atualização", () => {
  const rows = [row(0), row(1), row(4), row(9)];
  assert.deepEqual(spacedHistoryRows(rows, 3), [rows[0], rows[2], rows[3]]);
  assert.deepEqual(rows.map((item) => item.data_referencia), ["2026-01-01", "2026-01-02", "2026-01-05", "2026-01-10"]);
});

test("mantém as extremidades sem acumular dots próximos no fim do período", () => {
  const rows = daily(60);
  const markers = spacedHistoryRows(rows, 2);
  assert.equal(markers.length, 30);
  assert.equal(markers.at(-2), rows[56]);
  assert.equal(markers.at(-1), rows[59]);
});

test("exposição nula separa segmentos e preserva pontos isolados e atraso zero", () => {
  const rows = [row(0, 0), row(1, null), row(2, 0.2), row(3, null), row(4, 0.3)];
  assert.deepEqual(historyMarkerRows(rows, 10), [rows[0], rows[2], rows[4]]);
  assert.deepEqual(historyMarkerRows([row(0, null)], 1), []);
  assert.deepEqual(historyMarkerRows([], 1), []);
  assert.equal(historyDaySpan([]), 0);
});
