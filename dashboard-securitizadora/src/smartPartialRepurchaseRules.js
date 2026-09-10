import { buildImportTitleKey, IMPORT_ORIGINAL_VCTO_FIELD } from "./uploadOriginalDueDateRules.js";
import { isRepurchaseStatus, parseIsoDateLocal } from "./portfolioRiskRules.js";

export const SMART_SOURCE_TOTAL = "__smartSourceTotal";
export const SMART_SOURCE_FEES = "__smartSourceFees";
export const SMART_SOURCE_DISCOUNT = "__smartSourceDiscount";
export const SMART_REPURCHASE_HISTORY = "recompra_parcial";

const normalize = (value) => String(value ?? "").trim().toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const entity = (value) => normalize(value).replace(/(?:^|[\s-]+)(sacado|cedente)\s*$/, "")
  .replace(/[^a-z0-9]/g, "");
const cents = (value) => value === null || value === undefined || value === ""
  ? null : (Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : null);
const sameEntities = (a, b) => entity(a.Cliente) === entity(b.Cliente) && entity(a.Sacado) === entity(b.Sacado);
const isRepurchased = (row) => /recompr/.test(normalize(row.Status));
const isOpen = (row) => /^(aberto|a vencer|vencido|em aberto)$/.test(normalize(row.Status)) && !row.Pgto;
const isRemainingBalance = (row) => !isRepurchased(row) && (isOpen(row) || Boolean(parseIsoDateLocal(row.Pgto)));

export function getPartialRepurchaseEvents(row) {
  return Array.isArray(row?.[SMART_REPURCHASE_HISTORY]?.events) ? row[SMART_REPURCHASE_HISTORY].events : [];
}

export function getOriginalSmartTitle(row) {
  return row?.[SMART_REPURCHASE_HISTORY]?.original || row;
}

export function getSmartTitleAmounts(row) {
  const events = [...new Map(getPartialRepurchaseEvents(row).map((event) => [event.key, event])).values()];
  return {
    originalFace: (cents(getOriginalSmartTitle(row)?.Entrada) || 0) / 100,
    accumulatedCharges: (events.reduce((sum, event) => sum + (cents(event.charges) || 0), 0) + (cents(row?.Encargos) || 0)) / 100,
    openBalance: row?.Pgto || isRepurchaseStatus(row?.Status) ? 0 : (cents(row?.Entrada) || 0) / 100,
    accumulatedPaid: (events.reduce((sum, event) => sum + (cents(event.paid) || 0), 0) + (cents(row?.["Vl Pgto"]) || 0)) / 100,
  };
}

export function stripSmartSourceMetadata(row) {
  const copy = { ...row };
  delete copy[SMART_SOURCE_TOTAL];
  delete copy[SMART_SOURCE_FEES];
  delete copy[SMART_SOURCE_DISCOUNT];
  return copy;
}

const sourceSnapshot = (row) => {
  const copy = stripSmartSourceMetadata(row);
  delete copy[IMPORT_ORIGINAL_VCTO_FIELD];
  delete copy.__smartRenewalPreviousKey;
  delete copy[SMART_REPURCHASE_HISTORY];
  delete copy["Cód.Red"];
  return copy;
};

const reviewError = (row, reason) => new Error(
  `Recompra parcial do título ${row.Dcto}, OP ${row["Borderô"]}: ${reason}. Revise as linhas antes de importar.`
);

export function mergePartialRepurchaseHistory(existing, incoming) {
  if (!existing) return incoming || null;
  if (!incoming) return existing;
  const events = new Map((existing.events || []).map((event) => [event.key, event]));
  for (const event of incoming.events || []) events.set(event.key, event);
  return { version: 1, original: existing.original || incoming.original,
    events: [...events.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}

// Reconcile before deduplicating by current due date: the two source lines
// describe one title, and may even have the same current due date.
export function reconcileSmartPartialRepurchases(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!row.Dcto || !Number.isFinite(row["Borderô"]) || !row[IMPORT_ORIGINAL_VCTO_FIELD] ||
        !entity(row.Cliente) || !entity(row.Sacado)) continue;
    const key = JSON.stringify([entity(row.Cliente), entity(row.Sacado), buildImportTitleKey(row, true)]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const removed = new Set();
  const replacements = new Map();
  for (const entries of groups.values()) {
    const unique = [...new Map(entries.map((row) => [JSON.stringify({
      ...sourceSnapshot(row), total: row[SMART_SOURCE_TOTAL], fees: row[SMART_SOURCE_FEES],
      discount: row[SMART_SOURCE_DISCOUNT], original: row[IMPORT_ORIGINAL_VCTO_FIELD],
    }), row])).values()];
    const previous = unique.filter(isRepurchased);
    const remaining = unique.filter(isRemainingBalance);
    if (!previous.length || !remaining.length) continue;
    if (remaining.length !== 1 || unique.length !== previous.length + 1) {
      throw reviewError(previous[0], "há mais de uma combinação possível entre recompra e saldo");
    }
    const current = remaining[0];
    const pending = new Set(previous);
    const chain = [];
    let next = current;
    while (pending.size) {
      const candidates = [...pending].filter((candidate) => {
        const total = cents(candidate[SMART_SOURCE_TOTAL]);
        const paid = cents(candidate["Vl Pgto"]);
        const balance = cents(next.Entrada);
        return total !== null && paid !== null && balance !== null && paid > 0 && paid < total &&
          parseIsoDateLocal(candidate.Pgto) && (!next.Pgto || candidate.Pgto <= next.Pgto) &&
          Math.abs(total - paid - balance) <= 1;
      });
      if (candidates.length > 1) throw reviewError(current, "há mais de uma combinação possível entre recompra e saldo");
      if (candidates.length !== 1) throw reviewError(current, "o total anterior menos o liquidado não confere com o saldo seguinte, ou faltam dados da baixa");
      const old = candidates[0];
      chain.unshift({ old, current: next });
      pending.delete(old);
      next = old;
    }
    const events = chain.map(({ old, current }) => {
    const total = cents(old[SMART_SOURCE_TOTAL]);
    const paid = cents(old["Vl Pgto"]);
    const balance = cents(current.Entrada);
    const face = cents(old.Entrada);
    if (total === null || paid === null || face === null || face <= 0 || paid <= 0 ||
        paid >= total || balance === null || balance <= 0 || !old.Pgto ||
        !parseIsoDateLocal(old.Pgto) || (isOpen(current) && (cents(current["Vl Pgto"]) || 0) !== 0) ||
        Math.abs(total - paid - balance) > 1) {
      throw reviewError(old, "o total anterior menos o liquidado não confere com o saldo aberto, ou faltam dados da baixa");
    }
    return {
      key: `${buildImportTitleKey(old, true)}__${old.Vcto}__${old.Pgto}`,
      date: old.Pgto, faceValue: face / 100, charges: Number(old.Encargos || 0),
      fees: Number(old[SMART_SOURCE_FEES] || 0), discount: Number(old[SMART_SOURCE_DISCOUNT] || 0),
      total: total / 100, paid: paid / 100, remaining: balance / 100,
      previousDueDate: old.Vcto, dueDate: current.Vcto,
    };
    });
    const old = chain[0].old;
    const history = mergePartialRepurchaseHistory(current[SMART_REPURCHASE_HISTORY], {
      version: 1, original: sourceSnapshot(old), events,
    });
    const resolved = {
      ...current,
      ...(isOpen(current) ? { Status: "Aberto", Pgto: null, "Vl Pgto": 0 } : {}),
      Desagio: old.Desagio ?? current.Desagio,
      [SMART_REPURCHASE_HISTORY]: history,
    };
    for (const row of entries) removed.add(row);
    removed.delete(current);
    replacements.set(current, resolved);
  }
  return rows.filter((row) => !removed.has(row)).map((row) => replacements.get(row) || row);
}

// Resolve every target before any database write. Never silently drop an
// update just because another source row already claimed the same id.
export function planSmartTitleUpdates(rows, existingRows) {
  const index = new Map();
  for (const existing of existingRows) {
    const keys = new Set([buildImportTitleKey(existing)]);
    if (existing[SMART_REPURCHASE_HISTORY]?.original) {
      keys.add(buildImportTitleKey(existing[SMART_REPURCHASE_HISTORY].original));
    }
    for (const key of keys) {
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(existing);
    }
  }
  const rowsToInsert = [], rowsToUpdate = [], matchedExistingIds = new Set();
  for (const source of rows) {
    let existing;
    for (const key of new Set([buildImportTitleKey(source), buildImportTitleKey(source, true), source.__smartRenewalPreviousKey].filter(Boolean))) {
      const candidates = (index.get(key) || []).filter((row) => sameEntities(source, row));
      if ((index.get(key) || []).length && !candidates.length) {
        throw reviewError(source, "a chave já pertence a outro cedente ou sacado");
      }
      if (candidates.length > 1) throw reviewError(source, "mais de um registro existente corresponde ao título");
      if (candidates.length) { existing = candidates[0]; break; }
    }
    if (existing && !source[SMART_REPURCHASE_HISTORY] && isRepurchased(source) &&
        getPartialRepurchaseEvents(existing).some((event) => event.date === source.Pgto &&
          event.previousDueDate === source.Vcto && cents(event.paid) === cents(source["Vl Pgto"]))) {
      throw reviewError(source, "a recompra já está no histórico, mas o arquivo não traz o saldo correspondente");
    }
    const row = { ...source, [SMART_REPURCHASE_HISTORY]: mergePartialRepurchaseHistory(
      existing?.[SMART_REPURCHASE_HISTORY], source[SMART_REPURCHASE_HISTORY]
    ) };
    if (!existing?.id) { rowsToInsert.push(row); continue; }
    if (matchedExistingIds.has(existing.id)) {
      throw reviewError(source, "duas linhas tentam atualizar o mesmo registro e não formam uma recompra parcial validada");
    }
    matchedExistingIds.add(existing.id);
    for (const field of ["Desagio", "Tx.Efet"]) {
      if (row[field] === null || row[field] === undefined || (Number(row[field]) === 0 && Number(existing[field]) > 0)) row[field] = existing[field];
    }
    rowsToUpdate.push({ id: existing.id, row });
  }
  return { rowsToInsert, rowsToUpdate, matchedExistingIds };
}
