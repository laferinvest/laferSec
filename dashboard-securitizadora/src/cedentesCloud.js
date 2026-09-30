import { CATALOG_VERSION } from "./cedentesCatalog.js";
import { readSavedRecords, validateRecord } from "./cedentesTree.js";

const TABLE = "arvore_cedentes";
const COLUMNS = "id,cedente_key,sacado_key,alcance,cedente_nome,sacado_nome,familia,setor,finalidade,aplicacao,catalogo_versao,dados,revisao,created_at,updated_at";

function assertRecord(record) {
  const error = validateRecord(record);
  if (error) throw new Error(`Classificação inválida: ${error}`);
}

export function recordToRow(record, { allowLegacy = false } = {}) {
  assertRecord(record);
  if (!record.scope && !allowLegacy) throw new Error("Escolha o cedente da carteira antes de salvar.");
  if (record.fictional) throw new Error("Dados fictícios não podem ser salvos.");
  const dados = Object.fromEntries(Object.entries(record).filter(([key]) => !["id", "createdAt", "updatedAt", "revision", "fictional", "catalogVersion", "capitalCents", "overdueCents", "notDueCents", "titleCount"].includes(key)));
  return {
    ...(record.id ? { id: record.id } : {}),
    cedente_key: record.cedenteKey || null,
    sacado_key: record.scope === "sacado" ? record.sacadoKey : null,
    alcance: record.scope || "pendente",
    cedente_nome: record.name,
    sacado_nome: record.scope === "sacado" || (allowLegacy && !record.scope) ? record.buyer || null : null,
    familia: record.family,
    setor: record.sector || null,
    finalidade: record.purpose || null,
    aplicacao: record.application || null,
    catalogo_versao: record.catalogVersion || CATALOG_VERSION,
    dados,
  };
}

export function rowToRecord(row) {
  if (!row || row.catalogo_versao !== CATALOG_VERSION || !row.dados || Array.isArray(row.dados)) {
    throw new Error("O catálogo de um cadastro no Supabase está diferente. Atualize a classificação antes de editar.");
  }
  const record = {
    ...row.dados,
    id: row.id,
    scope: row.alcance === "pendente" ? "" : row.alcance,
    cedenteKey: row.cedente_key || "",
    sacadoKey: row.sacado_key || "",
    name: row.cedente_nome,
    buyer: row.sacado_nome || "",
    family: row.familia,
    sector: row.setor || "",
    purpose: row.finalidade || "",
    application: row.aplicacao || "",
    fictional: false,
    catalogVersion: row.catalogo_versao,
    revision: row.revisao,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  assertRecord(record);
  return record;
}

function translateError(error) {
  if (error?.code === "23P01") return "Este cedente ou sacado já foi classificado. Atualize a árvore antes de tentar novamente.";
  if (error?.code === "42P01" || error?.code === "PGRST205") return "A tabela de cedentes ainda não está disponível no Supabase.";
  return `O Supabase não concluiu a operação: ${error?.message || "erro desconhecido"}`;
}

export async function listCloudRecords(client, signal) {
  const records = [];
  let after;
  for (;;) {
    let query = client.from(TABLE).select(COLUMNS).is("excluida_em", null).order("id", { ascending: true }).limit(1000);
    if (after) query = query.gt("id", after);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw new Error(translateError(error));
    if (!Array.isArray(data)) throw new Error("Resposta inválida do Supabase ao carregar os cedentes.");
    if (!data.length) break;
    records.push(...data.map(rowToRecord));
    const next = data.at(-1).id;
    if (!next || next === after) throw new Error("A consulta da árvore não avançou até o fim dos cadastros.");
    after = next;
  }
  return records;
}

export async function saveCloudRecord(client, record) {
  const row = recordToRow(record);
  if (record.revision != null) {
    const { id, ...updates } = row;
    const { data, error } = await client.from(TABLE).update(updates).eq("id", id).eq("revisao", record.revision).is("excluida_em", null).select(COLUMNS).maybeSingle();
    if (error) throw new Error(translateError(error));
    if (!data) throw new Error("Este cadastro mudou em outra sessão. Atualize a árvore antes de editar novamente.");
    return rowToRecord(data);
  }
  const { data, error } = await client.from(TABLE).insert(row).select(COLUMNS).single();
  if (error) throw new Error(translateError(error));
  return rowToRecord(data);
}

export async function deleteCloudRecord(client, record) {
  if (!record.id || record.revision == null) throw new Error("Atualize a árvore antes de excluir esta classificação.");
  const { data, error } = await client.from(TABLE)
    .update({ excluida_em: new Date().toISOString() })
    .eq("id", record.id).eq("revisao", record.revision).is("excluida_em", null)
    .select("id").maybeSingle();
  if (error) throw new Error(translateError(error));
  if (!data) throw new Error("Esta classificação mudou ou já foi excluída em outra sessão. Atualize a árvore.");
}

export async function loadCloudWithLocalImport(client, storage, userId, signal) {
  const cloud = await listCloudRecords(client, signal);
  let local;
  try { local = readSavedRecords(storage, `lafer:cedentes-tree:v1:${userId}`); }
  catch { local = { records: [], error: "Não foi possível ler os cadastros antigos deste navegador." }; }
  if (local.error) return { records: cloud, importError: local.error };
  const known = new Set(cloud.map((record) => record.id));
  let importError = "";
  for (const record of local.records) {
    if (signal?.aborted) break;
    if (known.has(record.id)) continue;
    try {
      const { error } = await client.from(TABLE).insert(recordToRow(record, { allowLegacy: true }));
      if (error && error.code !== "23505") throw new Error(translateError(error));
      known.add(record.id);
    } catch (error) {
      importError = `Alguns cadastros deste navegador ainda não foram enviados ao Supabase. Os dados locais foram preservados. ${error.message}`;
      break;
    }
  }
  return { records: await listCloudRecords(client, signal), importError };
}
