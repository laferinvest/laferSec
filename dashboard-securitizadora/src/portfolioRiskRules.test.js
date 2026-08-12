import test from "node:test";
import assert from "node:assert/strict";

import {
  adjustToNextBusinessDay,
  applyPortfolioStatuses,
  calcularDiasAtrasoTitulo,
  isRefinancedRepurchase,
  isRepurchaseStatus,
  isValidPortfolioRow,
  parseIsoDateLocal,
} from "./portfolioRiskRules.js";

const TODAY = new Date(2026, 7, 11);

test("ajusta vencimento do fim de semana para a segunda-feira", () => {
  const saturday = parseIsoDateLocal("2026-08-08");
  const adjusted = adjustToNextBusinessDay(saturday);
  assert.equal(adjusted.getFullYear(), 2026);
  assert.equal(adjusted.getMonth(), 7);
  assert.equal(adjusted.getDate(), 10);
});

test("classifica a carteira com a mesma regra operacional do Microdashboard", () => {
  const rows = [
    { id: 1, Cliente: "100 - Cedente", Sacado: "Sacado A", Vcto: "2026-08-08", Pgto: null, Entrada: 100 },
    { id: 2, Cliente: "100 - Cedente", Sacado: "Sacado B", Vcto: "2026-08-12", Pgto: null, Entrada: 200 },
    { id: 3, Cliente: "100 - Cedente", Sacado: "Sacado C", Vcto: "2026-08-01", Pgto: null, Entrada: 300, Status: "Refinanciado" },
    { id: 4, Cliente: "160 - Cedente", Sacado: "Sacado D", Vcto: "2026-08-07", Pgto: "2026-08-11", Entrada: 400 },
    { id: 5, Cliente: "100 - Cedente", Sacado: "Sacado E", Vcto: "2026-08-07", Pgto: "2026-08-10", Entrada: 500 },
    { id: 6, Cliente: "100 - Cedente", Sacado: "Sacado F", Vcto: "2026-08-20", Pgto: null, Entrada: 600, Status: "REC" },
  ];

  const processed = applyPortfolioStatuses(rows, TODAY);
  assert.deepEqual(processed.map((row) => row._status), [
    "atraso",
    "aVencer",
    "recompra",
    "liquidado",
    "liquidadoAtraso",
    "recompra",
  ]);
  assert.equal(calcularDiasAtrasoTitulo(processed[0], "Vcto", "Pgto", TODAY), 1);
  assert.equal(calcularDiasAtrasoTitulo(processed[4], "Vcto", "Pgto", TODAY), 3);
});

test("Vl Pgto isolado não fecha o título e inadimplencia sim o retira da análise", () => {
  const partial = {
    Cliente: "100 - Cedente",
    Sacado: "Sacado A",
    Vcto: "2026-08-12",
    Pgto: null,
    "Vl Pgto": 50,
    Entrada: 100,
  };
  const excluded = { ...partial, inadimplencia: "SIM" };

  assert.equal(applyPortfolioStatuses([partial], TODAY)[0]._status, "aVencer");
  assert.equal(isValidPortfolioRow(partial), true);
  assert.equal(isValidPortfolioRow(excluded), false);
});

test("todo refinanciado é recompra, mesmo sem valor ou data de pagamento", () => {
  const base = {
    Cliente: "100 - Cedente",
    Sacado: "Sacado A",
    Vcto: "2026-08-01",
    Pgto: null,
    Status: "Refinanciado",
    Entrada: 100,
  };

  const rows = [
    { ...base, "Vl Pgto": 100 },
    { ...base, "Vl Pgto": 0 },
    { ...base, "Vl Pgto": null },
  ];

  assert.deepEqual(
    applyPortfolioStatuses(rows, TODAY).map((row) => row._status),
    ["recompra", "recompra", "recompra"],
  );
});

test("reconhece aliases de Valor Pgto em título refinanciado", () => {
  const aliases = ["Valor Pgto", "Valor Pago", "Vl.Pgto"];

  aliases.forEach((alias) => {
    const row = {
      Cliente: "100 - Cedente",
      Sacado: "Sacado A",
      Vcto: "2026-08-01",
      Status: "REFINANCIADO",
      [alias]: "R$ 1.234,56",
    };
    assert.equal(applyPortfolioStatuses([row], TODAY)[0]._status, "recompra");
  });
});

test("a recompra refinanciada independe de vencimento, pagamento e aliases de status", () => {
  const rows = [
    {
      Cliente: "100 - Cedente",
      Sacado: "Sacado A",
      Vcto: null,
      Status: "Refinanciado",
      "Vl Pgto": null,
    },
    {
      Cliente: "100 - Cedente",
      Sacado: "Sacado B",
      Vcto: "2026-08-20",
      Situação: "Refinanciado",
      "Valor Pago": 0,
    },
  ];

  assert.equal(isRefinancedRepurchase(rows[0]), true);
  assert.equal(isRefinancedRepurchase(rows[1]), true);
  assert.equal(isRepurchaseStatus("REC"), true);
  assert.equal(isRepurchaseStatus("Recomprado após cartório"), true);
  assert.equal(isRepurchaseStatus("Refinanciado"), true);
  assert.equal(isRepurchaseStatus("Aberto"), false);
  assert.deepEqual(
    applyPortfolioStatuses(rows, TODAY).map((row) => row._status),
    ["recompra", "recompra"],
  );
});

test("o total em aberto fecha com a soma de a vencer e em atraso", () => {
  const rows = [
    { Cliente: "Cedente A", Sacado: "Sacado A", Vcto: "2026-08-01", Entrada: 125 },
    { Cliente: "Cedente A", Sacado: "Sacado B", Vcto: "2026-08-20", Entrada: 250 },
    { Cliente: "Cedente A", Sacado: "Sacado C", Vcto: "2026-08-01", Pgto: "2026-08-04", Entrada: 500 },
  ];
  const processed = applyPortfolioStatuses(rows, TODAY);
  const openRows = processed.filter((row) => ["aVencer", "atraso"].includes(row._status));
  const openTotal = openRows.reduce((sum, row) => sum + row.Entrada, 0);
  const overdueTotal = openRows
    .filter((row) => row._status === "atraso")
    .reduce((sum, row) => sum + row.Entrada, 0);
  const currentTotal = openRows
    .filter((row) => row._status === "aVencer")
    .reduce((sum, row) => sum + row.Entrada, 0);

  assert.equal(openTotal, 375);
  assert.equal(overdueTotal, 125);
  assert.equal(currentTotal, 250);
  assert.equal(openTotal, overdueTotal + currentTotal);
});
