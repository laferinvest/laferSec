import test from "node:test";
import assert from "node:assert/strict";
import { calculateRiskExposure, getRiskReferenceDay, loadRiskDelayHistory, recordRiskDelayHistory } from "./riskDelayHistory.js";

const title = (patch = {}) => ({ Cliente: "100 - Empresa", Sacado: "Cliente final", Entrada: 100, Vcto: "2026-09-30", Pgto: null, Status: "Aberto", ...patch });

test("a data diária segue Brasília, inclusive na virada do dia UTC", () => {
  assert.equal(getRiskReferenceDay(new Date("2026-10-02T02:59:59Z")), "2026-10-01");
  assert.equal(getRiskReferenceDay(new Date("2026-10-02T03:00:00Z")), "2026-10-02");
});

test("exposição usa saldo atual e exclui títulos que Riscos e Alertas não considera", () => {
  const rows = [title({ Entrada: 70, recompra_parcial: { original: { Entrada: 100 } } }), title({ Entrada: 30, Vcto: "2026-10-01" }),
    ...["REC", "Recompra parcial", "Refinanciado", "RÉC"].map((Status) => title({ Status })),
    title({ inadimplencia: " SÍM " }), title({ Pgto: "2026-09-30" }), title({ Pgto: "inválido" }),
    title({ Vcto: null }), title({ Vcto: "2026-02-30" }), title({ Entrada: 0 }), title({ Entrada: -20 }),
    ...["", "0s", "0s- indefinido", "0 s- indefinido"].map((Sacado) => title({ Sacado })), title({ Cliente: " " })];
  const result = calculateRiskExposure(rows, "2026-10-01");
  assert.equal(result.totalOpen, 100);
  assert.equal(result.totalOverdue, 70);
  assert.equal(result.ratio, 0.7);
  assert.equal(result.openRows.length, 2);
});

test("vencimentos no fim de semana só ficam vencidos após segunda-feira", () => {
  const rows = [title({ Vcto: "2026-10-03" }), title({ Vcto: "2026-10-04" })];
  assert.equal(calculateRiskExposure(rows, "2026-10-05").ratio, 0);
  assert.equal(calculateRiskExposure(rows, "2026-10-06").ratio, 1);
});

test("sem exposição em aberto não inventa percentual de zero", () => {
  assert.equal(calculateRiskExposure([], "2026-10-01").ratio, null);
});

test("registro pede cálculo ao banco, sem enviar totais ou data escolhidos pelo cliente", async () => {
  const calls = [];
  const result = await recordRiskDelayHistory({ rpc: async (...args) => { calls.push(args); return { data: { percentual_atraso: 0.25 } }; } });
  assert.deepEqual(calls, [["registrar_historico_atraso"]]);
  assert.equal(result.percentual_atraso, 0.25);
  await assert.rejects(recordRiskDelayHistory({ rpc: async () => ({ error: { message: "Falha de rede" } }) }), /Falha de rede/);
  await assert.rejects(recordRiskDelayHistory({ rpc: async () => ({ data: null }) }), /não confirmou/);
});

test("histórico pagina além de mil dias e preserva lacunas sem exposição", async () => {
  const pages = [];
  const record = { data_referencia: "2026-10-01", percentual_atraso: "0.2", exposicao_aberto: "100", exposicao_vencida: "20" };
  const client = { from(name) {
    assert.equal(name, "risk_delay_history");
    return { select() { return this; }, order() { return this; }, async range(from, to) {
      pages.push([from, to]);
      return { data: from === 0 ? Array.from({ length: 1000 }, () => record) : [{ ...record, percentual_atraso: null }] };
    } };
  } };
  const rows = await loadRiskDelayHistory(client);
  assert.deepEqual(pages, [[0, 999], [1000, 1999]]);
  assert.equal(rows.length, 1001);
  assert.equal(rows[0].percentual_atraso, null);
  assert.equal(rows[1].percentual_atraso, 0.2);
});
