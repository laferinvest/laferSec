import test from "node:test";
import assert from "node:assert/strict";
import { applyPortfolioStatuses, isRepurchaseStatus } from "./portfolioRiskRules.js";
import { IMPORT_ORIGINAL_VCTO_FIELD as ORIGINAL, stripImportMetadata } from "./uploadOriginalDueDateRules.js";
import {
  SMART_SOURCE_TOTAL as TOTAL, SMART_SOURCE_FEES as FEES, SMART_SOURCE_DISCOUNT as DISCOUNT,
  reconcileSmartPartialRepurchases, planSmartTitleUpdates, getOriginalSmartTitle,
  getPartialRepurchaseEvents, stripSmartSourceMetadata, getSmartTitleAmounts,
  isPartialRepurchaseEvent,
} from "./smartPartialRepurchaseRules.js";

const original = {
  Cliente: "REFRIPOCOS REFRIGERACAO LTDA ME", Sacado: "HOTEL NACIONAL INN PALMAS-Sacado",
  Dcto: "2327", "Borderô": 143, "Dt.Emis": "2026-08-07", Vcto: "2026-08-31",
  [ORIGINAL]: "2026-08-31", Status: "Recomprado", Pgto: "2026-09-09",
  Entrada: 3500, "Vl Pgto": 1865.50, Desagio: 144.31, Encargos: 231,
  [TOTAL]: 3731, [FEES]: 0, [DISCOUNT]: 0,
};
const balance = { ...original, Vcto: "2026-09-09", Status: "Aberto", Pgto: null,
  Entrada: 1865.50, "Vl Pgto": 0, Desagio: 0, Encargos: 7.46, [TOTAL]: 1872.96 };

const partialPayment = {
  Cliente: "SOLUCAO COMERCIO DE INFORMATICA LTDA",
  Sacado: "MG SAO BENTO AGROPECUARIA E PARTICIPACOES LTDA-Sacado",
  Dcto: "122/2", "Borderô": 130, "Dt.Emis": "2026-07-31", Vcto: "2026-09-20",
  [ORIGINAL]: "2026-09-20", Status: "Quitado", Pgto: "2026-09-30",
  Entrada: 2800, "Vl Pgto": 125, Desagio: 227.05, Encargos: 196,
  [TOTAL]: 2996, [FEES]: 0, [DISCOUNT]: 0,
};
const paymentBalance = { ...partialPayment, Vcto: "2026-09-30", Status: "Aberto", Pgto: null,
  Entrada: 2871, "Vl Pgto": 0, Desagio: 0, Encargos: 11.48, [TOTAL]: 2882.48 };

test("pagamento parcial marcado Quitado no título 122/2 mantém apenas o saldo aberto", () => {
  for (const status of ["Quitado", "Liquidado"]) {
    for (const source of [[paymentBalance, { ...partialPayment, Status: status }], [{ ...partialPayment, Status: status }, paymentBalance]]) {
      const rows = reconcileSmartPartialRepurchases(source);
      assert.equal(rows.length, 1);
      const plan = planSmartTitleUpdates(rows, [{ ...partialPayment, id: 1, Status: "Aberto", Pgto: null, "Vl Pgto": 0 }]);
      assert.equal(plan.rowsToInsert.length, 0);
      assert.equal(plan.rowsToUpdate.length, 1);
      const saved = plan.rowsToUpdate[0].row;
      assert.equal(saved.Status, "Aberto");
      assert.equal(saved.Pgto, null);
      assert.equal(saved["Vl Pgto"], 0);
      assert.equal(saved.Desagio, 227.05);
      assert.equal(getPartialRepurchaseEvents(saved)[0].kind, "payment");
      assert.equal(getPartialRepurchaseEvents(saved).filter(isPartialRepurchaseEvent).length, 0);
      assert.deepEqual(getSmartTitleAmounts(saved), {
        originalFace: 2800, accumulatedCharges: 207.48, openBalance: 2871, accumulatedPaid: 125,
      });
      assert.equal(applyPortfolioStatuses([saved], new Date(2026, 9, 1))[0]._status, "atraso");
      const again = planSmartTitleUpdates(rows, [{ ...saved, id: 1 }]);
      assert.deepEqual(getSmartTitleAmounts(again.rowsToUpdate[0].row), getSmartTitleAmounts(saved));
      assert.equal(getPartialRepurchaseEvents(again.rowsToUpdate[0].row).length, 1);
    }
  }
});

test("pagamento histórico isolado não pode substituir o saldo importado", () => {
  const [saved] = reconcileSmartPartialRepurchases([partialPayment, paymentBalance]);
  assert.throws(() => planSmartTitleUpdates([partialPayment], [{ ...saved, id: 1 }]), /não traz o saldo correspondente/);
  const planned = planSmartTitleUpdates([paymentBalance], [{ ...saved, id: 1 }]);
  assert.equal(getPartialRepurchaseEvents(planned.rowsToUpdate[0].row).length, 1);
});

test("pagamento parcial exige saldo compatível e a quitação integral continua liquidada", () => {
  assert.throws(() => reconcileSmartPartialRepurchases([partialPayment, { ...paymentBalance, Entrada: 2870 }]), /não confere/);
  assert.throws(() => reconcileSmartPartialRepurchases([partialPayment, paymentBalance, { ...paymentBalance, Vcto: "2026-10-01" }]), /combinação possível/);
  const final = { ...paymentBalance, Status: "Quitado", Pgto: "2026-10-01", "Vl Pgto": 2882.48 };
  const [saved] = reconcileSmartPartialRepurchases([partialPayment, final]);
  assert.equal(saved.Status, "Quitado");
  assert.deepEqual(getSmartTitleAmounts(saved), {
    originalFace: 2800, accumulatedCharges: 207.48, openBalance: 0, accumulatedPaid: 3007.48,
  });
  assert.equal(applyPortfolioStatuses([saved], new Date(2026, 9, 1))[0]._status, "liquidadoAtraso");
  assert.deepEqual(reconcileSmartPartialRepurchases([final]), [final]);
});

test("sequência com pagamento e recompra mantém os tipos e os totais separados", () => {
  const second = { ...paymentBalance, Status: "Recomprado", Pgto: "2026-10-01", "Vl Pgto": 882.48 };
  const remaining = { ...paymentBalance, Vcto: "2026-10-01", Entrada: 2000, Encargos: 0, [TOTAL]: 2000 };
  const [saved] = reconcileSmartPartialRepurchases([remaining, partialPayment, second]);
  assert.deepEqual(getPartialRepurchaseEvents(saved).map(event => event.kind), ["payment", "repurchase"]);
  assert.deepEqual(getSmartTitleAmounts(saved), {
    originalFace: 2800, accumulatedCharges: 207.48, openBalance: 2000, accumulatedPaid: 1007.48,
  });
  const repurchases = getPartialRepurchaseEvents(saved).filter(isPartialRepurchaseEvent);
  assert.equal(repurchases.length, 1);
  assert.equal(repurchases[0].paid, 882.48);
  assert.equal(isPartialRepurchaseEvent({ paid: 125 }), true);
});

test("recompra integral do saldo depois de pagamento parcial encerra o título", () => {
  const final = { ...paymentBalance, Status: "Recomprado", Pgto: "2026-10-01", "Vl Pgto": 2882.48 };
  const [saved] = reconcileSmartPartialRepurchases([partialPayment, final]);
  assert.equal(saved.Status, "Recomprado");
  assert.equal(getPartialRepurchaseEvents(saved).length, 1);
  assert.equal(getPartialRepurchaseEvents(saved)[0].kind, "payment");
  assert.deepEqual(getSmartTitleAmounts(saved), {
    originalFace: 2800, accumulatedCharges: 207.48, openBalance: 0, accumulatedPaid: 3007.48,
  });
});

test("reconcilia a recompra parcial e mantém só o saldo aberto, sem inventar deságio", () => {
  const rows = reconcileSmartPartialRepurchases([balance, original]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Entrada, 1865.5);
  assert.equal(rows[0].Status, "Aberto");
  assert.equal(rows[0].Pgto, null);
  assert.equal(rows[0]["Vl Pgto"], 0);
  assert.equal(rows[0].Desagio, 144.31);
  assert.equal(rows[0].Encargos, 7.46);
  assert.equal(getOriginalSmartTitle(rows[0]).Entrada, 3500);
  const [event] = getPartialRepurchaseEvents(rows[0]);
  assert.equal(event.total - event.paid, event.remaining);
  assert.equal(event.paid, 1865.5);
  assert.equal(event.charges, 231);
  assert.equal(original.Status, "Recomprado");
});

test("saldo vencido continua aberto em atraso, sem virar recompra total ou liquidação", () => {
  const rows = reconcileSmartPartialRepurchases([original, balance]);
  assert.equal(applyPortfolioStatuses(rows, new Date(2026, 8, 10))[0]._status, "atraso");
  assert.equal(applyPortfolioStatuses(rows, new Date(2026, 8, 8))[0]._status, "aVencer");
  assert.equal(isRepurchaseStatus(rows[0].Status), false);
});

test("reenvio atualiza o mesmo id e conserva uma única movimentação", () => {
  const rows = reconcileSmartPartialRepurchases([original, balance]);
  const existing = { ...original, Status: "Aberto", Pgto: null, id: 397572 };
  const first = planSmartTitleUpdates(rows, [existing]);
  assert.equal(first.rowsToInsert.length, 0);
  assert.equal(first.rowsToUpdate.length, 1);
  assert.equal(first.rowsToUpdate[0].id, existing.id);
  const saved = { ...first.rowsToUpdate[0].row, id: existing.id };
  const second = planSmartTitleUpdates(rows, [saved]);
  assert.equal(second.rowsToInsert.length, 0);
  assert.equal(second.rowsToUpdate[0].id, existing.id);
  assert.deepEqual(second.rowsToUpdate[0].row.recompra_parcial, saved.recompra_parcial);
});

test("preserva o histórico quando o próximo arquivo contém somente o saldo", () => {
  const [row] = reconcileSmartPartialRepurchases([original, balance]);
  const planned = planSmartTitleUpdates([{ ...balance, Vcto: "2026-09-15" }], [{ ...row, id: 1 }]);
  assert.equal(planned.rowsToUpdate[0].id, 1);
  assert.equal(getPartialRepurchaseEvents(planned.rowsToUpdate[0].row).length, 1);
  assert.equal(planned.rowsToUpdate[0].row.Desagio, 144.31);
});

test("consolida o par mesmo se o vencimento atual não mudou e se os arquivos se repetem", () => {
  const sameDate = { ...balance, Vcto: original.Vcto };
  const rows = reconcileSmartPartialRepurchases([original, sameDate, { ...original, "Cód.Red": 99 }, { ...sameDate, "Cód.Red": 100 }]);
  assert.equal(rows.length, 1);
  assert.equal(getPartialRepurchaseEvents(rows[0]).length, 1);
});

test("não combina cedentes, sacados, operações ou originais diferentes", () => {
  for (const changed of [{ Cliente: "OUTRO" }, { Sacado: "OUTRO" }, { "Borderô": 144 }, { [ORIGINAL]: "2026-08-30" }]) {
    assert.equal(reconcileSmartPartialRepurchases([original, { ...balance, ...changed }]).length, 2);
  }
});

test("divergência de valores, baixa incompleta ou ambiguidade exige revisão", () => {
  for (const changed of [{ [TOTAL]: null }, { "Vl Pgto": 0 }, { Pgto: null }, { "Vl Pgto": 3731 }]) {
    assert.throws(() => reconcileSmartPartialRepurchases([{ ...original, ...changed }, balance]), /Revise as linhas/);
  }
  assert.throws(() => reconcileSmartPartialRepurchases([original, { ...balance, Entrada: 1800 }]), /não confere/);
  assert.throws(() => reconcileSmartPartialRepurchases([original, balance, { ...balance, Vcto: "2026-09-15" }]), /combinação possível/);
});

test("aceita no máximo um centavo de arredondamento", () => {
  assert.equal(reconcileSmartPartialRepurchases([original, { ...balance, Entrada: 1865.51 }]).length, 1);
  assert.throws(() => reconcileSmartPartialRepurchases([original, { ...balance, Entrada: 1865.52 }]), /não confere/);
});

test("recompra total e prorrogação sem recompra continuam com a regra existente", () => {
  assert.deepEqual(reconcileSmartPartialRepurchases([original]), [original]);
  assert.deepEqual(reconcileSmartPartialRepurchases([balance]), [balance]);
  const result = planSmartTitleUpdates([balance], [{ ...original, Status: "Aberto", id: 1 }]);
  assert.equal(result.rowsToUpdate[0].id, 1);
  assert.equal(result.rowsToUpdate[0].row.recompra_parcial, null);
});

test("rejeita colisão de id antes de montar qualquer gravação", () => {
  assert.throws(() => planSmartTitleUpdates([original, balance], [{ ...original, id: 1 }]), /duas linhas tentam atualizar/);
});

test("payload guarda o histórico, mas não as colunas temporárias da planilha", () => {
  const [row] = reconcileSmartPartialRepurchases([original, balance]);
  const payload = stripSmartSourceMetadata(stripImportMetadata(row));
  for (const key of [ORIGINAL, TOTAL, FEES, DISCOUNT]) assert.equal(Object.hasOwn(payload, key), false);
  assert.equal(payload.recompra_parcial.events.length, 1);
});

test("quitação posterior mantém o histórico e passa a ser liquidado", () => {
  const [row] = reconcileSmartPartialRepurchases([original, balance]);
  const result = planSmartTitleUpdates([{ ...balance, Status: "Liquidado", Pgto: "2026-09-09", "Vl Pgto": 1872.96 }], [{ ...row, id: 1 }]);
  const saved = result.rowsToUpdate[0].row;
  assert.equal(getPartialRepurchaseEvents(saved).length, 1);
  assert.equal(applyPortfolioStatuses([saved], new Date(2026, 8, 10))[0]._status, "liquidado");
});

test("uma linha histórica isolada não substitui o saldo já importado", () => {
  const [row] = reconcileSmartPartialRepurchases([original, balance]);
  assert.throws(() => planSmartTitleUpdates([original], [{ ...row, id: 1 }]), /não traz o saldo correspondente/);
});

test("uma chave pertencente a outra entidade é rejeitada antes das gravações", () => {
  assert.throws(() => planSmartTitleUpdates([balance], [{ ...original, id: 1, Cliente: "OUTRO" }]), /outro cedente ou sacado/);
});

test("arquivo com recompra anterior e saldo quitado mantém a face e os encargos da parcela final", () => {
  const settled = { ...balance, Status: "Liquidado", Pgto: "2026-09-10", "Vl Pgto": 1872.96 };
  const [open] = reconcileSmartPartialRepurchases([original, balance]);
  const rows = reconcileSmartPartialRepurchases([original, settled]);
  assert.equal(rows.length, 1);
  const planned = planSmartTitleUpdates(rows, [{ ...open, id: 1 }]);
  const final = planned.rowsToUpdate[0].row;
  assert.equal(final.Entrada, 1865.5);
  assert.equal(final.Encargos, 7.46);
  assert.equal(final["Vl Pgto"], 1872.96);
  assert.equal(final.Pgto, "2026-09-10");
  assert.equal(final.Status, "Liquidado");
  assert.equal(getOriginalSmartTitle(final).Entrada, 3500);
  assert.equal(getPartialRepurchaseEvents(final).length, 1);
  assert.equal(getPartialRepurchaseEvents(final)[0].charges, 231);
  assert.equal(applyPortfolioStatuses([final], new Date(2026, 8, 10))[0]._status, "liquidadoAtraso");
  const again = planSmartTitleUpdates(rows, [{ ...final, id: 1 }]);
  assert.equal(again.rowsToInsert.length, 0);
  assert.equal(again.rowsToUpdate[0].row.Entrada, 1865.5);
  assert.equal(getPartialRepurchaseEvents(again.rowsToUpdate[0].row).length, 1);
});

test("exibição usa face original e todos os encargos, preservando o saldo de risco", () => {
  const [row] = reconcileSmartPartialRepurchases([original, balance]);
  assert.deepEqual(getSmartTitleAmounts(row), {
    originalFace: 3500, accumulatedCharges: 238.46, openBalance: 1865.5, accumulatedPaid: 1865.5,
  });
  const paid = { ...row, Status: "Liquidado", Pgto: "2026-09-10", "Vl Pgto": 1872.96 };
  assert.deepEqual(getSmartTitleAmounts(paid), {
    originalFace: 3500, accumulatedCharges: 238.46, openBalance: 0, accumulatedPaid: 3738.46,
  });
  assert.equal(row.Entrada, 1865.5);
});

test("reconcilia duas recompras parciais e acumula cada etapa uma vez", () => {
  const second = { ...balance, Status: "Recomprado", Pgto: "2026-09-10", "Vl Pgto": 872.96 };
  const third = { ...balance, Vcto: "2026-09-20", Entrada: 1000, Encargos: 10, [TOTAL]: 1010 };
  const rows = reconcileSmartPartialRepurchases([third, original, second]);
  assert.equal(rows.length, 1);
  assert.deepEqual(getSmartTitleAmounts(rows[0]), {
    originalFace: 3500, accumulatedCharges: 248.46, openBalance: 1000, accumulatedPaid: 2738.46,
  });
  const reimport = planSmartTitleUpdates(rows, [{ ...rows[0], id: 1 }]).rowsToUpdate[0].row;
  assert.equal(getPartialRepurchaseEvents(reimport).length, 2);
  assert.equal(getSmartTitleAmounts(reimport).accumulatedCharges, 248.46);
  const final = reconcileSmartPartialRepurchases([original, second, {
    ...third, Status: "Liquidado", Pgto: "2026-09-20", "Vl Pgto": 1010,
  }])[0];
  assert.deepEqual(getSmartTitleAmounts(final), {
    originalFace: 3500, accumulatedCharges: 248.46, openBalance: 0, accumulatedPaid: 3748.46,
  });
});

test("nova etapa e atualização dos juros atuais não repetem encargos anteriores", () => {
  const [saved] = reconcileSmartPartialRepurchases([original, balance]);
  const second = { ...balance, Status: "Recomprado", Pgto: "2026-09-10", "Vl Pgto": 872.96 };
  const third = { ...balance, Vcto: "2026-09-20", Entrada: 1000, Encargos: 10, [TOTAL]: 1010 };
  const rows = reconcileSmartPartialRepurchases([second, third]);
  const current = planSmartTitleUpdates(rows, [{ ...saved, id: 1 }]).rowsToUpdate[0].row;
  assert.equal(getSmartTitleAmounts(current).originalFace, 3500);
  assert.equal(getSmartTitleAmounts(current).accumulatedCharges, 248.46);
  const updated = planSmartTitleUpdates([{ ...third, Encargos: 12 }], [{ ...current, id: 1 }]).rowsToUpdate[0].row;
  assert.equal(getSmartTitleAmounts(updated).accumulatedCharges, 250.46);
  assert.equal(getPartialRepurchaseEvents(updated).length, 2);
});

test("recompra final do saldo do título 2327 preserva a parcial e zera o risco", () => {
  const finalRepurchase = { ...balance, Status: "Recomprado", Pgto: "2026-09-24",
    "Vl Pgto": 1865.5, Encargos: 0, [TOTAL]: 1865.5 };
  const [open] = reconcileSmartPartialRepurchases([original, balance]);
  for (const source of [[finalRepurchase, original], [original, finalRepurchase]]) {
    const rows = reconcileSmartPartialRepurchases(source);
    assert.equal(rows.length, 1);
    const planned = planSmartTitleUpdates(rows, [{ ...open, id: 1 }]);
    assert.equal(planned.rowsToInsert.length, 0);
    assert.equal(planned.rowsToUpdate.length, 1);
    assert.equal(planned.rowsToUpdate[0].id, 1);
    const final = planned.rowsToUpdate[0].row;
    assert.equal(final.Status, "Recomprado");
    assert.equal(final.Pgto, "2026-09-24");
    assert.equal(final.Entrada, 1865.5);
    assert.equal(final.Desagio, 144.31);
    assert.equal(getPartialRepurchaseEvents(final).length, 1);
    assert.deepEqual(getSmartTitleAmounts(final), {
      originalFace: 3500, accumulatedCharges: 231, openBalance: 0, accumulatedPaid: 3731,
    });
    assert.equal(applyPortfolioStatuses([final], new Date(2026, 8, 25))[0]._status, "recompra");
    const again = planSmartTitleUpdates(rows, [{ ...final, id: 1 }]);
    assert.deepEqual(again.rowsToUpdate[0].row.recompra_parcial, final.recompra_parcial);
    assert.deepEqual(getSmartTitleAmounts(again.rowsToUpdate[0].row), getSmartTitleAmounts(final));
  }
});

test("recompra final exige baixa completa, saldo compatível e ordem cronológica", () => {
  const finalRepurchase = { ...balance, Status: "Recomprado", Pgto: "2026-09-24", "Vl Pgto": 1872.96 };
  const [open] = reconcileSmartPartialRepurchases([original, balance]);
  for (const changed of [{ [TOTAL]: null }, { Pgto: null }, { "Vl Pgto": 872.96 }, { "Vl Pgto": 1872.98 }]) {
    const rows = reconcileSmartPartialRepurchases([original, { ...finalRepurchase, ...changed }]);
    assert.throws(() => planSmartTitleUpdates(rows, [{ ...open, id: 1 }]), /não traz o saldo correspondente/);
  }
  for (const changed of [{ Entrada: 1800 }, { Entrada: 0 }, { Pgto: "2026-09-08" }]) {
    assert.throws(() => planSmartTitleUpdates(
      reconcileSmartPartialRepurchases([original, { ...finalRepurchase, ...changed }]),
      [{ ...open, id: 1 }]
    ), /Revise as linhas/);
  }
  assert.throws(() => reconcileSmartPartialRepurchases([
    original, finalRepurchase, { ...finalRepurchase, Vcto: "2026-09-10" },
  ]), /combinação possível/);
  assert.deepEqual(reconcileSmartPartialRepurchases([finalRepurchase]), [finalRepurchase]);
});

test("recompra final encerra várias parciais sem duplicar pagamentos ou encargos", () => {
  const second = { ...balance, Status: "Recomprado", Pgto: "2026-09-10", "Vl Pgto": 872.96 };
  const finalRepurchase = { ...balance, Vcto: "2026-09-20", Entrada: 1000, Encargos: 10,
    [TOTAL]: 1010, Status: "Recomprado", Pgto: "2026-09-24", "Vl Pgto": 1010 };
  const rows = reconcileSmartPartialRepurchases([finalRepurchase, original, second, { ...finalRepurchase, "Cód.Red": 99 }]);
  assert.equal(rows.length, 1);
  assert.equal(getPartialRepurchaseEvents(rows[0]).length, 2);
  assert.deepEqual(getSmartTitleAmounts(rows[0]), {
    originalFace: 3500, accumulatedCharges: 248.46, openBalance: 0, accumulatedPaid: 3748.46,
  });
});
