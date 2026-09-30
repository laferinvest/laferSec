import { applyPortfolioStatuses, isValidPortfolioRow } from "./portfolioRiskRules.js";

const LEGAL_SUFFIXES = new Set(["ltda", "lt", "me", "eireli", "epp", "sa", "s/a", "ss", "s/s", "mei", "com", "comercio", "industria", "servicos", "servico", "importacao", "exportacao"]);
export const displayEntityName = (name) => String(name || "").trim().replace(/^\d+\s*-\s*/, "").replace(/\s*-\s*sacado\s*$/i, "");

// Same grouping convention as the existing Operações e Recebíveis lists.
export function portfolioEntityKey(name) {
  const normalized = displayEntityName(name).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").split(" ")
    .map((token) => LEGAL_SUFFIXES.has(token) ? "" : token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token)
    .filter(Boolean).join(" ").trim();
  return normalized.slice(0, 36);
}

export const formatCapital = (cents, hidden = false) => hidden ? "R$ •••" : Number.isSafeInteger(cents)
  ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100)
  : "Indisponível";

function newBucket(key, name) {
  return { key, name: displayEntityName(name), aliases: [], capitalCents: 0, overdueCents: 0, notDueCents: 0, titleCount: 0 };
}

function addAlias(bucket, name) {
  if (!bucket.aliases.includes(name)) bucket.aliases.push(name);
  const label = displayEntityName(name);
  if (label.length > bucket.name.length) bucket.name = label;
}

export function buildPortfolioIndex(rows, today = new Date()) {
  const cedentes = new Map();
  const seenRows = new Set();
  const valid = rows.filter(isValidPortfolioRow).filter((row) => {
    if (row.id === undefined || row.id === null) return true;
    const rowKey = `${row._sourceTable || "secInfo"}/${row.id}`;
    if (seenRows.has(rowKey)) return false;
    seenRows.add(rowKey);
    return true;
  });
  const asOf = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  for (const row of applyPortfolioStatuses(valid.map((item) => ({ ...item, Status: item.Status || item.Estado || "" })), asOf)) {
    const cedenteKey = portfolioEntityKey(row.Cliente);
    const sacadoKey = portfolioEntityKey(row.Sacado);
    if (!cedenteKey || !sacadoKey) continue;
    if (!cedentes.has(cedenteKey)) cedentes.set(cedenteKey, { ...newBucket(cedenteKey, row.Cliente), buyers: new Map() });
    const cedente = cedentes.get(cedenteKey);
    addAlias(cedente, row.Cliente);
    if (!cedente.buyers.has(sacadoKey)) cedente.buyers.set(sacadoKey, newBucket(sacadoKey, row.Sacado));
    const buyer = cedente.buyers.get(sacadoKey);
    addAlias(buyer, row.Sacado);
    if (!["aVencer", "atraso"].includes(row._status)) continue;
    // Entrada is the current principal remaining after partial repurchases, not original face.
    const amount = Math.round(Number(row.Entrada) * 100);
    if (!Number.isSafeInteger(amount) || amount <= 0) continue;
    for (const bucket of [cedente, buyer]) {
      bucket.capitalCents += amount;
      bucket.titleCount += 1;
      if (row._status === "atraso") bucket.overdueCents += amount;
      else bucket.notDueCents += amount;
    }
  }
  const sorted = [...cedentes.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  sorted.forEach((cedente) => { cedente.buyers = [...cedente.buyers.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")); });
  return { cedentes: sorted, totalCents: sorted.reduce((sum, cedente) => sum + cedente.capitalCents, 0) };
}

export const PORTFOLIO_COLUMNS = 'id,Cliente,Sacado,Entrada,Vcto,Pgto,Status,Estado,inadimplencia';

export async function fetchPortfolioTable(client, table, signal) {
  const rows = [];
  let after;
  for (;;) {
    let query = client.from(table).select(PORTFOLIO_COLUMNS).order("id", { ascending: true }).limit(1000);
    if (after !== undefined) query = query.gt("id", after);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw new Error(`Não foi possível carregar a carteira (${table}): ${error.message}`);
    if (!Array.isArray(data)) throw new Error(`Resposta inválida ao carregar a carteira (${table}).`);
    if (!data.length) break;
    const next = data.at(-1).id;
    if (next === null || next === undefined || next === after) throw new Error("Não foi possível avançar na leitura completa da carteira.");
    rows.push(...data.map((row) => ({ ...row, _sourceTable: table })));
    after = next;
    // Continue even on a short page: the server may impose a lower row limit.
  }
  return rows;
}

export async function loadCedentesPortfolio(client, signal) {
  const results = await Promise.allSettled([fetchPortfolioTable(client, "secInfo", signal), fetchPortfolioTable(client, "secInfoSmart", signal)]);
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw failed.reason; // Never present partial data from only one source as the full capital.
  return { ...buildPortfolioIndex(results.flatMap((result) => result.value)), loadedAt: new Date().toISOString() };
}

export function resolvePortfolioScope(record, portfolio) {
  if (!record.scope) return { status: "legacy", message: "Cadastro anterior sem vínculo com a carteira. Edite para escolher o cedente e o alcance." };
  if (portfolio.status !== "ready") return { status: portfolio.status, message: portfolio.status === "loading" ? "Carregando capital da carteira…" : "Capital indisponível: atualize a carteira." };
  const cedente = portfolio.cedentes.find((item) => item.key === record.cedenteKey);
  if (!cedente) return { status: "missing", message: "Cedente não encontrado na carteira atual. Revise o vínculo antes de salvar." };
  const bucket = record.scope === "cedente" ? cedente : cedente.buyers.find((buyer) => buyer.key === record.sacadoKey);
  if (!bucket) return { status: "missing", message: "Selecione um sacado da lista deste cedente." };
  return { status: "ready", ...bucket, cedenteName: cedente.name, buyerCount: record.scope === "cedente" ? cedente.buyers.length : 1 };
}

export function bindPortfolioScope(record, portfolio) {
  const resolved = resolvePortfolioScope(record, portfolio);
  if (resolved.status !== "ready") return { error: resolved.message };
  return { record: { ...record, name: resolved.cedenteName, buyer: record.scope === "sacado" ? resolved.name : "", sacadoKey: record.scope === "sacado" ? record.sacadoKey : "", parcel: record.scope === "sacado" ? `Todos os títulos de ${resolved.name}` : "Todos os sacados do cedente" } };
}

export function scopeConflict(records, candidate) {
  if (!candidate.scope || !candidate.cedenteKey) return "";
  const conflict = records.find((record) => record.id !== candidate.id && record.scope && record.cedenteKey === candidate.cedenteKey &&
    (record.scope === "cedente" || candidate.scope === "cedente" || record.sacadoKey === candidate.sacadoKey));
  if (!conflict) return "";
  if (conflict.scope === "cedente") return "Este cedente já está classificado por inteiro. Edite essa classificação para evitar contar o mesmo capital novamente.";
  if (candidate.scope === "cedente") return "Já existem sacados classificados para este cedente. Edite os vínculos existentes antes de classificar o cedente inteiro, para não duplicar o capital.";
  return "Este sacado já está classificado para o cedente. Edite a classificação existente para evitar duplicidade.";
}

export function summarizeLinkedCapital(records, portfolio) {
  let capitalCents = 0;
  let unavailable = 0;
  const counted = new Set();
  for (const record of records) {
    const resolved = resolvePortfolioScope(record, portfolio);
    if (resolved.status !== "ready") { unavailable += 1; continue; }
    const cedente = portfolio.cedentes.find((item) => item.key === record.cedenteKey);
    const buyers = record.scope === "cedente" ? cedente.buyers : cedente.buyers.filter((buyer) => buyer.key === record.sacadoKey);
    for (const buyer of buyers) {
      const key = JSON.stringify([cedente.key, buyer.key]);
      if (counted.has(key)) continue;
      counted.add(key);
      capitalCents += buyer.capitalCents;
    }
  }
  return { capitalCents, unavailable, linked: records.length - unavailable };
}
