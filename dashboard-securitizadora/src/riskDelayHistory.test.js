import test from "node:test";
import assert from "node:assert/strict";
import { buildRiskCedenteOptions, calculateRiskExposure, getRiskReferenceDay, isRiskCedenteVisible, loadRiskDelayCedentes, loadRiskDelayHistory, recordRiskDelayHistory } from "./riskDelayHistory.js";

const title = (patch = {}) => ({ Cliente: "100 - Empresa", Sacado: "Cliente final", Entrada: 100, Vcto: "2026-09-30", Pgto: null, Status: "Aberto", ...patch });

test("oculta os cedentes solicitados mesmo com códigos, pontuação e palavras antes do nome", () => {
  const hidden = [
    "59 399 143 SHIRLEI APARECIDA", "59.399.143/0001-00 - Shirlei Aparecida",
    "123 - LUIS CARLOS LELECO LTDA", "COMERCIAL ATACADO PRIMU LTDA", "ATACADO PRIMUS",
    "GRUPO LAFER INVEST LTDA", "59.339 EMPRESA LTDA", "COMPANHIA UAI",
    "EMPÓRIO TROVOADA", "GRID MOTORS", "INDUMAX", "INOVA", "J.L. COMERCIO",
    "KAMMER", "M.G. LTDA", "MARCENARIA", "MILK LAT", "R10", "REGES",
    "S.L. LTDA", "SOLUÇÃO COMERCIO", "VISUAL",
  ];
  for (const cedente of hidden) {
    assert.equal(isRiskCedenteVisible({ cedente }), false, cedente);
    assert.equal(isRiskCedenteVisible({ cedente_key: cedente }), false, cedente);
  }
});

test("não oculta outros cedentes por trechos de palavras parecidas", () => {
  for (const cedente of ["EMPRESA NORMAL", "INOVACAO LTDA", "AUDIOVISUAL LTDA", "REGESSON", "AMG", "JLM", "R100", "59 399 143 OUTRA EMPRESA"]) {
    assert.equal(isRiskCedenteVisible({ cedente }), true, cedente);
  }
  assert.equal(isRiskCedenteVisible({ cedente_key: "", cedente: "" }), true);
});

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

test("cedentes repetidos nas duas bases são unidos sem truncar ou aproximar nomes distintos", () => {
  const options = buildRiskCedenteOptions([
    { Cliente: "100 - ÁGUA Mineral Ltda." }, { Cliente: "200 - Agua Mineral LTDA" },
    { Cliente: "300 - Agua Mineral Distribuidora" }, { Cliente: " " },
  ]);
  assert.equal(options.length, 2);
  assert.deepEqual(options.map((item) => item.cedente_key).sort(), ["agua mineral distribuidora", "agua mineral ltda"]);
});

test("a série individual pede ao banco apenas o cedente escolhido e mantém seu denominador", async () => {
  const calls = [];
  const client = { rpc(name, params) {
    calls.push([name, params]);
    return { order() { return this; }, async range() { return { data: [
      { data_referencia: "2026-10-02", exposicao_vencida: "0", exposicao_aberto: "0", percentual_atraso: null },
      { data_referencia: "2026-10-01", exposicao_vencida: "20", exposicao_aberto: "40", percentual_atraso: "0.5" },
    ] }; } };
  } };
  const series = await loadRiskDelayHistory(client, "agua mineral ltda");
  assert.deepEqual(calls, [["consultar_historico_atraso_cedente", { chave_cedente: "agua mineral ltda" }]]);
  assert.equal(series[0].percentual_atraso, 0.5);
  assert.equal(series[0].exposicao_aberto, 40);
  assert.equal(series[1].percentual_atraso, null);
});

test("opções do seletor usam o último fechamento individual e não inventam dados passados", async () => {
  const client = { from(name) {
    assert.equal(name, "risk_delay_history");
    return { select(column) { assert.equal(column, "cedentes"); return this; },
      not(column, op, value) { assert.deepEqual([column, op, value], ["cedentes", "is", null]); return this; },
      order() { return this; }, async limit(value) { assert.equal(value, 1); return { data: [{ cedentes: [
        { cedente_key: "empresa", cedente: "Empresa", exposicao_aberto: 100 },
      ] }] }; } };
  } };
  assert.deepEqual(await loadRiskDelayCedentes(client), [{ cedente_key: "empresa", cedente: "Empresa" }]);
  await assert.rejects(loadRiskDelayCedentes({ from() { return {
    select() { return this; }, not() { return this; }, order() { return this; },
    async limit() { return { error: { message: "Sem acesso" } }; },
  }; } }), /Sem acesso/);
});
