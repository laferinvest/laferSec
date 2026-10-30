import test from "node:test";
import assert from "node:assert/strict";
import { loadCedenteSettings } from "./cedenteSettings.js";
import { isCedenteNameVisible } from "./cedentesVisibility.js";

function clientFor(result) {
  const calls = [];
  const query = {
    select(value) { calls.push(["select", value]); return this; },
    eq(...values) { calls.push(["eq", ...values]); return this; },
    abortSignal(value) { calls.push(["signal", value]); return this; },
    async single() { return result; },
  };
  return { calls, from(table) { calls.push(["from", table]); return query; } };
}

test("carrega somente a configuração privada e normaliza aliases sem duplicatas", async () => {
  const client = clientFor({ data: { hidden_aliases: ["Cliente Fictício Alfa", "cliente ficticio alfa", "X.Y."] } });
  const signal = new AbortController().signal;
  const { hiddenAliases } = await loadCedenteSettings(client, signal);
  assert.deepEqual(hiddenAliases, ["cliente ficticio alfa", "x y"]);
  assert.deepEqual(client.calls, [["from", "cedente_private_settings"], ["select", "hidden_aliases"], ["eq", "id", "visibility"], ["signal", signal]]);
  assert.equal(isCedenteNameVisible(hiddenAliases, "123 - Cliente Fictício Alfa"), false);
  assert.equal(isCedenteNameVisible(hiddenAliases, "Cliente Ficticio Alfabetico"), true);
});

test("erro de acesso ou registro ausente não libera um painel sem configuração", async () => {
  await assert.rejects(loadCedenteSettings(clientFor({ error: { message: "restricted private detail" } })), /Não foi possível/);
  for (const data of [null, {}, { hidden_aliases: null }, { hidden_aliases: [123] }, { hidden_aliases: [""] }, { hidden_aliases: ["---"] }]) {
    await assert.rejects(loadCedenteSettings(clientFor({ data })), /inválidas/);
  }
});

test("configurações recebidas de usuários diferentes não compartilham estado global", async () => {
  const a = await loadCedenteSettings(clientFor({ data: { hidden_aliases: ["cliente ficticio alfa"] } }));
  const b = await loadCedenteSettings(clientFor({ data: { hidden_aliases: ["cliente ficticio beta"] } }));
  assert.equal(isCedenteNameVisible(a.hiddenAliases, "Cliente ficticio alfa"), false);
  assert.equal(isCedenteNameVisible(b.hiddenAliases, "Cliente ficticio alfa"), true);
  assert.deepEqual(await loadCedenteSettings(clientFor({ data: { hidden_aliases: [] } })), { hiddenAliases: [] });
});
