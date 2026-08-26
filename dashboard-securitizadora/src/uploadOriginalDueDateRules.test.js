import test from "node:test";
import assert from "node:assert/strict";

import {
  IMPORT_ORIGINAL_VCTO_FIELD,
  buildImportTitleKey,
  getImportMatchVcto,
  stripImportMetadata,
} from "./uploadOriginalDueDateRules.js";

test("usa Original para localizar o mesmo titulo quando o vencimento mudou", () => {
  const existingRow = { Dcto: "2225", "Borderô": 975, Vcto: "2026-08-20" };
  const incomingRow = {
    Dcto: "2225",
    "Borderô": 975,
    Vcto: "2026-08-31",
    [IMPORT_ORIGINAL_VCTO_FIELD]: "2026-08-20",
  };

  assert.notEqual(buildImportTitleKey(existingRow), buildImportTitleKey(incomingRow));
  assert.equal(buildImportTitleKey(existingRow), buildImportTitleKey(incomingRow, true));
  assert.equal(getImportMatchVcto(incomingRow), "2026-08-20");
});

test("mantem o vencimento atual como fallback quando Original nao foi informado", () => {
  const incomingRow = { Dcto: "2225", "Borderô": 975, Vcto: "2026-08-31" };

  assert.equal(buildImportTitleKey(incomingRow), buildImportTitleKey(incomingRow, true));
  assert.equal(getImportMatchVcto(incomingRow), "2026-08-31");
});

test("remove Original antes de enviar o payload ao banco", () => {
  const row = {
    Dcto: "2225",
    Vcto: "2026-08-31",
    [IMPORT_ORIGINAL_VCTO_FIELD]: "2026-08-20",
  };

  const databaseRow = stripImportMetadata(row);

  assert.equal(databaseRow.Vcto, "2026-08-31");
  assert.equal(Object.hasOwn(databaseRow, IMPORT_ORIGINAL_VCTO_FIELD), false);
});
