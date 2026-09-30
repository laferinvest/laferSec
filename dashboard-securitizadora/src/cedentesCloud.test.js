import test from "node:test";
import assert from "node:assert/strict";
import { CATALOG_VERSION } from "./cedentesCatalog.js";
import { deleteCloudRecord, loadCloudWithLocalImport, recordToRow, rowToRecord, saveCloudRecord } from "./cedentesCloud.js";
import { emptyRecord } from "./cedentesTree.js";

const ID = "11111111-1111-4111-8111-111111111111";
const sample = (patch = {}) => ({ ...emptyRecord(), id: ID, name: "Cedente A", parcel: "Todos os títulos de Sacado A", buyer: "Sacado A", scope: "sacado", cedenteKey: "cedente a", sacadoKey: "sacado a", family: "FAM-A", ...patch });
const dbRow = (record, revision = 1) => ({ ...recordToRow(record), id: record.id, revisao: revision, created_at: "2026-09-29T12:00:00Z", updated_at: "2026-09-29T12:00:00Z" });

test("salva classificação e vínculo sem congelar capital da carteira", () => {
  const record = sample({ capitalCents: 90000, revision: 4 });
  const row = recordToRow(record);
  assert.equal(row.alcance, "sacado");
  assert.equal(row.sacado_key, "sacado a");
  assert.equal(row.catalogo_versao, CATALOG_VERSION);
  assert.equal(row.dados.capitalCents, undefined);
  assert.equal(row.revisao, undefined);
  assert.equal(row.created_at, undefined);
  const back = rowToRecord(dbRow(sample()));
  assert.equal(back.scope, "sacado");
  assert.equal(back.revision, 1);
  assert.equal(back.buyer, "Sacado A");
});

test("preserva cadastro local antigo sem vínculo para revisão posterior", () => {
  const legacy = sample({ scope: "", cedenteKey: "", sacadoKey: "", buyer: "Sacado antigo", parcel: "Parcela antiga" });
  assert.throws(() => recordToRow(legacy), /Escolha o cedente/);
  const row = recordToRow(legacy, { allowLegacy: true });
  assert.equal(row.alcance, "pendente");
  assert.equal(row.sacado_nome, "Sacado antigo");
  assert.equal(rowToRecord({ ...row, revisao: 1, created_at: "x", updated_at: "x" }).buyer, "Sacado antigo");
});

test("edição condiciona a revisão para não sobrescrever mudança de outra sessão", async () => {
  let sent;
  const client = { from() { return { update(row) { sent = row; return this; }, eq() { return this; }, is() { return this; }, select() { return this; }, async maybeSingle() { return { data: null, error: null }; } }; } };
  await assert.rejects(saveCloudRecord(client, sample({ revision: 3 })), /outra sessão/);
  assert.equal(sent.id, undefined);
  assert.equal(sent.revisao, undefined);
});

test("importação dos cadastros locais é idempotente e mantém o arquivo original", async () => {
  const record = sample();
  let inserted = 0;
  let stored = [];
  const client = { from() { let after = false; return {
    select() { return this; }, is() { return this; }, order() { return this; }, limit() { return this; }, gt() { after = true; return this; },
    insert(row) { inserted++; stored = [dbRow(rowToRecord({ ...row, id: row.id, revisao: 1, created_at: "x", updated_at: "x" }))]; return Promise.resolve({ error: null }); },
    then(resolve) { return Promise.resolve({ data: after ? [] : stored, error: null }).then(resolve); },
  }; } };
  const local = JSON.stringify({ catalogVersion: CATALOG_VERSION, records: [record] });
  const storage = { getItem: () => local };
  const first = await loadCloudWithLocalImport(client, storage, "u1");
  const second = await loadCloudWithLocalImport(client, storage, "u1");
  assert.equal(inserted, 1);
  assert.equal(first.records.length, 1);
  assert.equal(second.records.length, 1);
  assert.equal(storage.getItem(), local);
});

test("exclusão preserva a linha e exige a revisão atual de uma classificação ativa", async () => {
  let sent;
  const filters = [];
  let data = { id: ID };
  const client = { from() { return {
    update(row) { sent = row; return this; },
    eq(key, value) { filters.push([key, value]); return this; },
    is(key, value) { filters.push([key, value]); return this; },
    select() { return this; },
    async maybeSingle() { return { data, error: null }; },
  }; } };
  await deleteCloudRecord(client, sample({ revision: 3 }));
  assert.deepEqual(Object.keys(sent), ["excluida_em"]);
  assert.ok(!Number.isNaN(Date.parse(sent.excluida_em)));
  assert.deepEqual(filters, [["id", ID], ["revisao", 3], ["excluida_em", null]]);
  data = null;
  await assert.rejects(deleteCloudRecord(client, sample({ revision: 3 })), /mudou ou já foi excluída/);
});

test("cadastro local antigo não recria classificação excluída no Supabase", async () => {
  const local = JSON.stringify({ catalogVersion: CATALOG_VERSION, records: [sample()] });
  let imports = 0;
  const client = { from() { return {
    select() { return this; },
    is(column, value) { assert.equal(column, "excluida_em"); assert.equal(value, null); return this; },
    order() { return this; }, limit() { return this; },
    insert() { imports++; return Promise.resolve({ error: { code: "23505" } }); },
    then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
  }; } };
  const result = await loadCloudWithLocalImport(client, { getItem: () => local }, "u1");
  assert.equal(imports, 1);
  assert.deepEqual(result.records, []);
  assert.equal(result.importError, "");
});
