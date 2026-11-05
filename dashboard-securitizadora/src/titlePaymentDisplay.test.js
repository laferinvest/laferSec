import test from "node:test";
import assert from "node:assert/strict";
import { getSmartTitleAmounts, getTitlePaymentForDisplay } from "./smartPartialRepurchaseRules.js";

const title = () => ({
  _sourceTable: "secInfoSmart", Entrada: 7900, Encargos: 600,
  Status: "Quitado", Pgto: "2026-03-04", "Vl Pgto": 8500,
  recompra_parcial: {
    original: { Entrada: 12000 },
    events: [
      { key: "first", kind: "payment", paid: 3000, charges: 100 },
      { key: "second", kind: "payment", paid: 1500, charges: 300 },
    ],
  },
});

test("título quitado com duas baixas parciais mostra o total recebido sem alterar a última baixa", () => {
  const row = title();
  const before = structuredClone(row);
  assert.equal(getTitlePaymentForDisplay(row), 13000);
  assert.equal(getTitlePaymentForDisplay(row), 13000);
  assert.equal(getSmartTitleAmounts(row).openBalance, 0);
  assert.equal(getTitlePaymentForDisplay(row), getSmartTitleAmounts(row).originalFace + getSmartTitleAmounts(row).accumulatedCharges);
  assert.deepEqual(row, before);
  assert.equal(row["Vl Pgto"], 8500);
});

test("título ainda aberto mostra os pagamentos anteriores sem mudar seu saldo", () => {
  const row = { ...title(), Pgto: null, Status: "Aberto", "Vl Pgto": 0 };
  assert.equal(getTitlePaymentForDisplay(row), 4500);
  assert.equal(getSmartTitleAmounts(row).openBalance, 7900);
  assert.equal(row["Vl Pgto"], 0);
});

test("histórico duplicado não duplica valores e recompra final acumula a sequência", () => {
  const row = title();
  row.recompra_parcial.events.push({ ...row.recompra_parcial.events[0] });
  assert.equal(getTitlePaymentForDisplay(row), 13000);
  row.Status = "Recomprado";
  row.recompra_parcial.events[0].kind = "repurchase";
  assert.equal(getTitlePaymentForDisplay(row), 13000);
});

test("fontes misturadas preservam WBA e títulos sem histórico", () => {
  const smart = title();
  const wba = { ...title(), _sourceTable: "secInfo" };
  assert.equal(getTitlePaymentForDisplay(wba, "secInfoSmart"), 8500);
  assert.equal(getTitlePaymentForDisplay({ ...smart, recompra_parcial: null }), 8500);
  const { _sourceTable: source, ...untagged } = smart;
  assert.equal(source, "secInfoSmart");
  assert.equal(getTitlePaymentForDisplay(untagged, "secInfoSmart"), 13000);
  assert.equal(getTitlePaymentForDisplay(untagged, "secInfo"), 8500);
});
