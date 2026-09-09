import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSettlementUpdatePayload,
  buildSettlementEvidenceIndex,
  findSettlementEvidence,
  isSettlementEvidenceRow,
} from "./uploadSettlementRules.js";
import { IMPORT_ORIGINAL_VCTO_FIELD } from "./uploadOriginalDueDateRules.js";

test("reconcilia título quitado sem borderô por Cliente + Dcto + Vcto", () => {
  const sourceRows = [
    {
      Cliente: "PSR DISTRIBUIDORA",
      Sacado: "VET AGRO-Sacado",
      Dcto: "2738-2",
      Vcto: "2026-06-30",
      Pgto: "2026-07-07",
      "Vl Pgto": 2046.21,
      Entrada: 2046.21,
      Status: "Quitado",
      "Borderô": null,
    },
  ];
  const target = {
    Cliente: "PSR DISTRIBUIDORA",
    Sacado: "VET AGRO-Sacado",
    Dcto: "2738-2",
    Vcto: "2026-06-30",
    Pgto: null,
    Status: "Aberto",
    Entrada: 2018,
    "Borderô": 525,
  };

  assert.equal(isSettlementEvidenceRow(sourceRows[0]), true);
  assert.equal(findSettlementEvidence(target, buildSettlementEvidenceIndex(sourceRows)), sourceRows[0]);
});

test("escolhe a quitação mais recente quando há pagamentos parcelados no mesmo vencimento", () => {
  const sourceRows = [
    { Cliente: "PSR", Sacado: "VET", Dcto: "2738-2", Vcto: "2026-06-30", Pgto: "2026-06-30", "Vl Pgto": 2000, Status: "Quitado" },
    { Cliente: "PSR", Sacado: "VET", Dcto: "2738-2", Vcto: "2026-06-30", Pgto: "2026-07-07", "Vl Pgto": 2046.21, Status: "Quitado" },
  ];
  const target = { Cliente: "PSR", Sacado: "VET", Dcto: "2738-2", Vcto: "2026-06-30" };

  const match = findSettlementEvidence(target, buildSettlementEvidenceIndex(sourceRows));
  assert.equal(match.Pgto, "2026-07-07");
  assert.equal(match["Vl Pgto"], 2046.21);
});

test("reconcilia quitação depois de prorrogar o vencimento", () => {
  const settlement = {
    Cliente: "REFRIPOCOS REFRIGERACAO LTDA ME",
    Sacado: "GOLDEN TOWER EXPRESS ANHEMBI-Sacado",
    Dcto: "2225",
    "Dt.Emis": "2026-05-20",
    Vcto: "2026-08-31",
    [IMPORT_ORIGINAL_VCTO_FIELD]: "2026-08-20",
    Pgto: "2026-08-31",
    "Vl Pgto": 5000,
    Status: "Quitado",
  };
  const index = buildSettlementEvidenceIndex([settlement]);
  const targetBeforeRenewal = {
    Cliente: settlement.Cliente,
    Sacado: settlement.Sacado,
    Dcto: "2225",
    Vcto: "2026-08-20",
    Status: "Aberto",
  };
  const targetAfterRenewal = {
    ...targetBeforeRenewal,
    Vcto: "2026-08-31",
  };

  assert.equal(findSettlementEvidence(targetBeforeRenewal, index), settlement);
  assert.equal(findSettlementEvidence(targetAfterRenewal, index), settlement);
});

test("não usa fallback ambíguo quando o mesmo Dcto + Vcto pertence a cedentes diferentes", () => {
  const sourceRows = [
    { Cliente: "Cedente A", Dcto: "10", Vcto: "2026-06-30", Pgto: "2026-07-01", Status: "Quitado" },
    { Cliente: "Cedente B", Dcto: "10", Vcto: "2026-06-30", Pgto: "2026-07-02", Status: "Quitado" },
  ];
  const target = { Cliente: "Cedente C", Dcto: "10", Vcto: "2026-06-30" };

  assert.equal(findSettlementEvidence(target, buildSettlementEvidenceIndex(sourceRows)), null);
});

test("a baixa atualiza somente status e pagamento, preservando o valor de face do banco", () => {
  const source = {
    Cliente: "PSR",
    Dcto: "2738-2",
    Vcto: "2026-06-30",
    Pgto: "2026-07-07",
    "Vl Pgto": 2046.21,
    Entrada: 2046.21,
    Status: "Quitado",
    "Borderô": null,
  };

  assert.deepEqual(buildSettlementUpdatePayload(source), {
    Status: "Quitado",
    Pgto: "2026-07-07",
    "Vl Pgto": 2046.21,
  });
});
