import test from "node:test";
import assert from "node:assert/strict";
import { bindPortfolioScope, buildPortfolioIndex, fetchPortfolioTable, loadCedentesPortfolio, portfolioEntityKey, resolvePortfolioScope, scopeConflict, summarizeLinkedCapital } from "./cedentesPortfolio.js";
import { buildTree, emptyRecord, flattenTree, validateRecord } from "./cedentesTree.js";

const TODAY = new Date(2026, 8, 29);
const row = (id, overrides = {}) => ({ id, Cliente: "100 - Aurora Máquinas LTDA", Sacado: "Horizonte Alimentos - Sacado", Entrada: 100, Vcto: "2026-10-10", Pgto: null, Status: "Aberto", _sourceTable: "secInfo", ...overrides });
const index = (rows) => ({ ...buildPortfolioIndex(rows, TODAY), status: "ready", loadedAt: "2026-09-29T12:00:00Z" });
const record = (overrides = {}) => ({ ...emptyRecord(), id: "record-a", name: "Aurora Máquinas", parcel: "Todos os títulos de Horizonte Alimentos", family: "FAM-A", sector: "SET-A1", purpose: "FIN-I", application: "APL-EMB", scope: "sacado", cedenteKey: portfolioEntityKey("Aurora Máquinas"), sacadoKey: portfolioEntityKey("Horizonte Alimentos"), buyer: "Horizonte Alimentos", ...overrides });

test("capital soma principal aberto, incluindo atrasos e o saldo restante de recompra parcial", () => {
  const portfolio = index([
    row(1, { Entrada: 100.15 }), row(2, { Entrada: 30.25, Vcto: "2026-09-01" }),
    row(3, { Entrada: 40, _sourceTable: "secInfoSmart", recompra_parcial: { original: { Entrada: 500 }, events: [{ paid: 460 }] } }),
    row(4, { Entrada: 1000, Pgto: "2026-09-28" }), row(5, { Entrada: 1000, Status: "Recomprado" }),
    row(6, { Entrada: 1000, Status: "Refinanciado" }), row(7, { Entrada: 1000, inadimplencia: "SIM" }),
    row(8, { Entrada: 1000, Vcto: null }), row(9, { Entrada: -30 }),
  ]);
  const cedente = portfolio.cedentes[0];
  assert.equal(cedente.capitalCents, 17040);
  assert.equal(cedente.titleCount, 3);
  assert.equal(cedente.overdueCents, 3025);
  assert.equal(cedente.notDueCents, 14015);
  assert.equal(cedente.buyers[0].capitalCents, 17040);
});

test("listas mantêm sacados restritos ao cedente, agrupam aliases e mantêm saldo zero conhecido", () => {
  const portfolio = index([
    row(1), row(2, { Cliente: "Aurora Maquinas Ltda", Entrada: 50 }),
    row(3, { Sacado: "Comprador quitado", Pgto: "2026-09-20" }),
    row(4, { Cliente: "Cedente Beta", Sacado: "Exclusivo Beta", Entrada: 70 }),
    row(5, { Cliente: "Cedente Beta", Sacado: "Horizonte Alimentos", Entrada: 20 }),
    row(6, { Sacado: "0s" }),
  ]);
  assert.equal(portfolio.cedentes.length, 2);
  const aurora = portfolio.cedentes.find((item) => item.key === portfolioEntityKey("Aurora Máquinas"));
  assert.equal(aurora.capitalCents, 15000);
  assert.equal(aurora.buyers.length, 2);
  assert.ok(!aurora.buyers.some((buyer) => buyer.name === "Exclusivo Beta"));
  assert.equal(aurora.buyers.find((buyer) => buyer.name === "Comprador quitado").capitalCents, 0);
});

test("deduplica ids da mesma origem sem descartar ids iguais de origens diferentes", () => {
  const portfolio = index([row(1), row(1), row(1, { _sourceTable: "secInfoSmart", Entrada: 80 })]);
  assert.equal(portfolio.totalCents, 18000);
});

test("vínculo de sacado exige relação válida e cedente inteiro soma todos os seus sacados", () => {
  const portfolio = index([row(1), row(2, { Sacado: "Segundo comprador", Entrada: 200 })]);
  const scoped = record();
  assert.equal(resolvePortfolioScope(scoped, portfolio).capitalCents, 10000);
  const whole = record({ scope: "cedente", buyer: "", sacadoKey: "" });
  assert.equal(resolvePortfolioScope(whole, portfolio).capitalCents, 30000);
  assert.equal(bindPortfolioScope(whole, portfolio).record.parcel, "Todos os sacados do cedente");
  assert.ok(bindPortfolioScope(record({ sacadoKey: "sacado inexistente" }), portfolio).error);
  assert.ok(bindPortfolioScope(record({ cedenteKey: "cedente inexistente" }), portfolio).error);
  assert.equal(validateRecord(bindPortfolioScope(scoped, portfolio).record), "");
});

test("mesmo vínculo acompanha a atualização do saldo sem armazenar uma fotografia do capital", () => {
  const scoped = record();
  assert.equal(resolvePortfolioScope(scoped, index([row(1)])).capitalCents, 10000);
  assert.equal(resolvePortfolioScope(scoped, index([row(1, { Pgto: "2026-09-29" })])).capitalCents, 0);
  assert.equal(resolvePortfolioScope(scoped, { status: "error", cedentes: [] }).capitalCents, undefined);
  assert.equal(resolvePortfolioScope(record({ scope: "" }), index([row(1)])).status, "legacy");
});

test("bloqueia dupla classificação do mesmo sacado e sobreposição com cedente inteiro", () => {
  const buyer = record();
  const whole = record({ id: "whole", scope: "cedente", buyer: "", sacadoKey: "" });
  assert.ok(scopeConflict([buyer], whole));
  assert.ok(scopeConflict([whole], buyer));
  assert.ok(scopeConflict([buyer], record({ id: "other", sector: "SET-A2" })));
  assert.equal(scopeConflict([buyer], record({ id: "other", sacadoKey: "outro" })), "");
  assert.equal(scopeConflict([buyer], buyer), "");
});

test("saldo agregado usa a união dos vínculos e sinaliza classificações antigas sem saldo", () => {
  const portfolio = index([row(1), row(2, { Sacado: "Segundo comprador", Entrada: 200 })]);
  const result = summarizeLinkedCapital([record(), record({ id: "whole", scope: "cedente", sacadoKey: "", buyer: "" }), record({ id: "old", scope: "" })], portfolio);
  assert.equal(result.capitalCents, 30000);
  assert.equal(result.unavailable, 1);
});

test("visualização só por cedente agrupa folhas do mesmo ramo sem perder vínculos", () => {
  const records = [record(), record({ id: "second", buyer: "Outro sacado", sacadoKey: "outro" }), record({ id: "third", buyer: "Terceiro", sacadoKey: "terceiro", sector: "SET-A2" })];
  const grouped = flattenTree(buildTree(records, { showBuyers: false }));
  const leaves = grouped.filter((node) => node.kind === "record");
  assert.equal(leaves.length, 2);
  assert.deepEqual(leaves[0].recordIds, ["record-a", "second"]);
  assert.equal(grouped[0].recordIds.length, 3);
  assert.equal(flattenTree(buildTree(records, { showBuyers: true })).filter((node) => node.kind === "record").length, 3);
});

function pagedClient(tables, cap = 2, failureTable = "") {
  const calls = [];
  return {
    calls,
    from(table) {
      let after;
      const query = {
        select() { return query; }, order() { return query; }, limit() { return query; }, abortSignal() { return query; },
        gt(column, value) { assert.equal(column, "id"); after = value; return query; },
        then(resolve) {
          calls.push({ table, after });
          return Promise.resolve(table === failureTable ? { error: { message: "Consulta negada" }, data: null } : { error: null, data: tables[table].filter((item) => after === undefined || item.id > after).slice(0, cap) }).then(resolve);
        },
      };
      return query;
    },
  };
}

test("paginação percorre todos os registros mesmo com limite do servidor menor que a página", async () => {
  const client = pagedClient({ secInfo: [row(1), row(2), row(3), row(4), row(5)] });
  const rows = await fetchPortfolioTable(client, "secInfo");
  assert.equal(rows.length, 5);
  assert.deepEqual(client.calls.map((call) => call.after), [undefined, 2, 4, 5]);
});

test("carrega as duas origens e não apresenta capital incompleto se uma consulta falhar", async () => {
  const tables = { secInfo: [row(1)], secInfoSmart: [row(1, { Entrada: 50 })] };
  const result = await loadCedentesPortfolio(pagedClient(tables));
  assert.equal(result.totalCents, 15000);
  await assert.rejects(loadCedentesPortfolio(pagedClient(tables, 2, "secInfoSmart")), /Consulta negada/);
});
