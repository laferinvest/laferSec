function normalizeRuleText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseIsoDateLocal(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const raw = String(value).trim().split("T")[0];
  let year;
  let month;
  let day;

  if (raw.includes("-")) {
    const parts = raw.split("-");
    if (parts.length !== 3) return null;
    [year, month, day] = parts.map(Number);
  } else if (raw.includes("/")) {
    const parts = raw.split("/").map(Number);
    if (parts.length !== 3) return null;
    if (parts[0] > 31) [year, month, day] = parts;
    else [day, month, year] = parts;
    if (year > 0 && year < 100) year += 2000;
  } else {
    return null;
  }

  if (!year || !month || !day) return null;
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) return null;

  return parsed;
}

function isWeekendDate(date) {
  return date.getDay() === 0 || date.getDay() === 6;
}

export function adjustToNextBusinessDay(date) {
  const adjusted = new Date(date);
  if (adjusted.getDay() === 6) adjusted.setDate(adjusted.getDate() + 2);
  if (adjusted.getDay() === 0) adjusted.setDate(adjusted.getDate() + 1);
  return adjusted;
}

export function addBusinessDays(date, daysToAdd) {
  const result = new Date(date);
  let added = 0;
  while (added < daysToAdd) {
    result.setDate(result.getDate() + 1);
    if (!isWeekendDate(result)) added += 1;
  }
  return result;
}

export const adicionarDiasUteis = addBusinessDays;

export function diffCalendarDays(startDate, endDate) {
  const startUtc = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const endUtc = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  return Math.round((endUtc - startUtc) / 86400000);
}

export function getTodayLocalDate() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

export function getDiasUteisToleranciaComissaria(cedente) {
  const normalized = String(cedente ?? "").trim();
  if (normalized.startsWith("160 -") || normalized.startsWith("260 -")) return 2;
  if (normalized.startsWith("466 -") || normalized.startsWith("479 -")) return 1;
  return 0;
}

export function isInadimplente(row) {
  return normalizeRuleText(row?.inadimplencia) === "sim";
}

export function isStatusRefinanciado(statusValue) {
  return normalizeRuleText(statusValue).replace(/[^a-z0-9]+/g, " ").trim().includes("refinanc");
}

export function isRepurchaseStatus(statusValue) {
  const normalized = normalizeRuleText(statusValue).replace(/[^a-z0-9]+/g, " ").trim();
  const tokens = normalized.split(" ").filter(Boolean);
  return tokens.includes("rec") || normalized.includes("recompr") || normalized.includes("refinanc");
}

function getRowValue(row, preferredKey, matcher) {
  if (preferredKey && row?.[preferredKey] !== undefined) return row[preferredKey];
  const matchingKey = Object.keys(row || {}).find(matcher);
  return matchingKey ? row[matchingKey] : null;
}

export function isValidPortfolioRow(row) {
  const sacado = String(row?.Sacado ?? "").trim();
  const cedente = String(row?.Cliente ?? "").trim();
  const sacadoInvalido = !sacado || sacado === "0s" || sacado.startsWith("0 s-") || sacado.startsWith("0s-");
  return Boolean(cedente) && !sacadoInvalido && !isInadimplente(row);
}

export function findPortfolioKeyAcrossRows(rows, matcher) {
  for (const row of rows || []) {
    const key = Object.keys(row || {}).find(matcher);
    if (key) return key;
  }
  return undefined;
}

export function getPortfolioColumnKeys(rows) {
  return {
    vctoKey: findPortfolioKeyAcrossRows(rows, (key) => {
      const normalized = key.toLowerCase();
      return normalized === "vcto" || (normalized.includes("vcto") && !normalized.includes("vl"));
    }),
    pgtoKey: findPortfolioKeyAcrossRows(rows, (key) => {
      const normalized = key.toLowerCase();
      return normalized === "pgto" || (normalized.includes("pgto") && !normalized.includes("vl"));
    }),
    statusKey: findPortfolioKeyAcrossRows(rows, (key) => {
      const normalized = key.toLowerCase();
      return normalized === "status" || normalized === "estado";
    }),
  };
}

export function isRefinancedRepurchase(row, keys = {}) {
  const statusValue = getRowValue(row, keys.statusKey, (key) => {
    const normalized = normalizeRuleText(key);
    return normalized === "status" || normalized === "estado" || normalized === "situacao";
  });
  return isStatusRefinanciado(statusValue);
}

export function classifyPortfolioRow(row, keys, today = getTodayLocalDate()) {
  const { vctoKey, pgtoKey, statusKey } = keys || {};
  const statusValue = getRowValue(row, statusKey, (key) => {
    const normalized = normalizeRuleText(key);
    return normalized === "status" || normalized === "estado" || normalized === "situacao";
  });
  if (isRepurchaseStatus(statusValue)) return "recompra";

  const dueDate = vctoKey ? parseIsoDateLocal(row?.[vctoKey]) : null;
  if (!dueDate) return "invalido";

  const effectiveDueDate = adjustToNextBusinessDay(dueDate);

  const paymentValue = pgtoKey ? row?.[pgtoKey] : null;
  if (paymentValue !== null && paymentValue !== undefined && String(paymentValue).trim() !== "") {
    const paymentDate = parseIsoDateLocal(paymentValue);
    if (!paymentDate) return "invalido";
    const toleranceDays = getDiasUteisToleranciaComissaria(row?.Cliente);
    const finalToleranceDate = toleranceDays > 0
      ? addBusinessDays(effectiveDueDate, toleranceDays)
      : effectiveDueDate;
    return paymentDate <= finalToleranceDate ? "liquidado" : "liquidadoAtraso";
  }

  return effectiveDueDate < today ? "atraso" : "aVencer";
}

export function applyPortfolioStatuses(rows, today = getTodayLocalDate()) {
  const keys = getPortfolioColumnKeys(rows);
  return (rows || []).map((row) => ({
    ...row,
    _status: classifyPortfolioRow(row, keys, today),
  }));
}

export function calcularDiasAtrasoTitulo(row, vctoKey, pgtoKey, today = getTodayLocalDate()) {
  if (!row || !vctoKey) return 0;
  const dueDate = parseIsoDateLocal(row[vctoKey]);
  if (!dueDate) return 0;

  const effectiveDueDate = adjustToNextBusinessDay(dueDate);
  let referenceDate = null;
  if (row._status === "liquidadoAtraso") referenceDate = pgtoKey ? parseIsoDateLocal(row[pgtoKey]) : null;
  else if (row._status === "atraso") referenceDate = today;
  else if (row._status === "recompra") referenceDate = (pgtoKey ? parseIsoDateLocal(row[pgtoKey]) : null) || today;

  return referenceDate ? Math.max(0, diffCalendarDays(effectiveDueDate, referenceDate)) : 0;
}
