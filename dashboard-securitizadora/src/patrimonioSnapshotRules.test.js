import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateMonthVariation,
  groupSnapshotsByMonth,
} from "./patrimonioSnapshotRules.js";

test("soma a variação de todos os snapshots do mês atual", () => {
  const rows = [
    { data: "2026-07-31", pl: 2098923.92, compraDebentures: -44237.29 },
    { data: "2026-08-11", pl: 2144973.53, compraDebentures: 0 },
    { data: "2026-08-12", pl: 2138772.03, compraDebentures: 0 },
  ];

  assert.equal(calculateMonthVariation(rows, new Date(2026, 7, 12)), 39848.11);
});

test("desconta os fluxos externos de cada snapshot do mês", () => {
  const rows = [
    { data: "2026-07-31", pl: 1000, compraDebentures: 0 },
    { data: "2026-08-05", pl: 1300, compraDebentures: 200 },
    { data: "2026-08-12", pl: 1250, compraDebentures: -25 },
  ];

  assert.equal(calculateMonthVariation(rows, "2026-08-12"), 75);
});

test("retorna zero quando não há snapshot no mês atual", () => {
  assert.equal(calculateMonthVariation([{ data: "2026-07-31", pl: 1000 }], "2026-08-12"), 0);
});

test("a linha mensal agrega variação, retorno composto e fluxo de todos os snapshots", () => {
  const groups = groupSnapshotsByMonth([
    {
      data: "2026-08-11",
      pl: 2144973.53,
      recebiveis: 1830853.43,
      dinheiroBanco: 314120.1,
      compraDebentures: 100,
      variacao: 46049.61,
      periodReturn: 0.0219,
      retornoAcumuladoPct: 105.64,
    },
    {
      data: "2026-08-12",
      pl: 2138772.03,
      recebiveis: 1807493.41,
      dinheiroBanco: 331278.62,
      compraDebentures: -25,
      variacao: -6201.5,
      periodReturn: -0.0029,
      retornoAcumuladoPct: 105.05,
    },
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].data, "2026-08-12");
  assert.equal(groups[0].pl, 2138772.03);
  assert.equal(groups[0].recebiveis, 1807493.41);
  assert.equal(groups[0].dinheiroBanco, 331278.62);
  assert.equal(groups[0].variacao, 39848.11);
  assert.equal(groups[0].compraDebentures, 75);
  assert.equal(groups[0].periodReturn, (1 + 0.0219) * (1 - 0.0029) - 1);
  assert.equal(groups[0].retornoMesPct, ((1 + 0.0219) * (1 - 0.0029) - 1) * 100);
  assert.equal(groups[0].retornoAcumuladoPct, 105.05);
  assert.deepEqual(groups[0].snapshots.map((row) => row.data), ["2026-08-11", "2026-08-12"]);
});

test("ordena os meses e os snapshots antes de montar os agregados", () => {
  const groups = groupSnapshotsByMonth([
    { data: "2026-08-12", variacao: 20, periodReturn: 0.02 },
    { data: "2026-07-31", variacao: 10, periodReturn: 0.01 },
    { data: "2026-08-11", variacao: 30, periodReturn: 0.03 },
  ]);

  assert.deepEqual(groups.map((group) => group.mes), ["2026-07", "2026-08"]);
  assert.deepEqual(groups[1].snapshots.map((row) => row.data), ["2026-08-11", "2026-08-12"]);
  assert.equal(groups[1].variacao, 50);
});
