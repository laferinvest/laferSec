const normalizeText = (value) =>
  String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const normalizeKey = (value) => String(value ?? "").trim().replace(/\.0$/, "");

const normalizeEntity = (value) =>
  normalizeText(value)
    .replace(/(?:^|[\s-]+)(sacado|cedente)\s*$/i, "")
    .replace(/[^a-z0-9]/g, "");

const normalizeDocument = (value) => normalizeKey(value).replace(/[^a-z0-9]/gi, "").toLowerCase();

const settlementKey = (entity, dcto, vcto) =>
  `${normalizeEntity(entity)}__${normalizeDocument(dcto)}__${normalizeKey(vcto)}`;

const documentDueKey = (dcto, vcto) =>
  `${normalizeDocument(dcto)}__${normalizeKey(vcto)}`;

const paymentTimestamp = (row) => {
  const raw = normalizeKey(row?.Pgto);
  if (!raw) return 0;
  const parsed = Date.parse(`${raw.split("T")[0]}T00:00:00`);
  return Number.isFinite(parsed) ? parsed : 0;
};

const paymentAmount = (row) => Number(row?.["Vl Pgto"] || 0);

const isClosedStatus = (status) => {
  const normalized = normalizeText(status);
  return normalized.includes("baixad") || normalized.includes("liquidad") || normalized.includes("quitad");
};

export const isSettlementEvidenceRow = (row) =>
  Boolean(normalizeKey(row?.Dcto) && normalizeKey(row?.Vcto)) &&
  (isClosedStatus(row?.Status) || Boolean(normalizeKey(row?.Pgto)));

const preferSettlement = (current, candidate) => {
  if (!current) return candidate;
  const paymentDateDifference = paymentTimestamp(candidate) - paymentTimestamp(current);
  if (paymentDateDifference !== 0) return paymentDateDifference > 0 ? candidate : current;
  return paymentAmount(candidate) > paymentAmount(current) ? candidate : current;
};

export function buildSettlementEvidenceIndex(rows) {
  const byCliente = new Map();
  const bySacado = new Map();
  const byDocumentDue = new Map();

  (rows || []).filter(isSettlementEvidenceRow).forEach((row) => {
    const clienteKey = settlementKey(row.Cliente, row.Dcto, row.Vcto);
    const sacadoKey = settlementKey(row.Sacado, row.Dcto, row.Vcto);
    const fallbackKey = documentDueKey(row.Dcto, row.Vcto);

    if (normalizeEntity(row.Cliente)) {
      byCliente.set(clienteKey, preferSettlement(byCliente.get(clienteKey), row));
    }
    if (normalizeEntity(row.Sacado)) {
      bySacado.set(sacadoKey, preferSettlement(bySacado.get(sacadoKey), row));
    }

    const fallback = byDocumentDue.get(fallbackKey);
    if (!fallback) {
      byDocumentDue.set(fallbackKey, { row, entities: new Set([normalizeEntity(row.Cliente)]) });
    } else {
      fallback.entities.add(normalizeEntity(row.Cliente));
      fallback.row = preferSettlement(fallback.row, row);
    }
  });

  return { byCliente, bySacado, byDocumentDue };
}

export function findSettlementEvidence(targetRow, index) {
  if (!targetRow || !index) return null;

  const byCliente = index.byCliente.get(settlementKey(targetRow.Cliente, targetRow.Dcto, targetRow.Vcto));
  if (byCliente) return byCliente;

  const bySacado = index.bySacado.get(settlementKey(targetRow.Sacado, targetRow.Dcto, targetRow.Vcto));
  if (bySacado) return bySacado;

  const fallback = index.byDocumentDue.get(documentDueKey(targetRow.Dcto, targetRow.Vcto));
  return fallback?.entities?.size === 1 ? fallback.row : null;
}

export function buildSettlementUpdatePayload(sourceRow) {
  if (!isSettlementEvidenceRow(sourceRow)) return null;
  return {
    Status: sourceRow.Status,
    Pgto: sourceRow.Pgto,
    "Vl Pgto": sourceRow["Vl Pgto"],
  };
}
