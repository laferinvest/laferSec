import { APPLICATIONS, ATTRIBUTES, CAPEX_REASONS, CATALOG_VERSION, CHANNELS, DIRECTIONS, EFFECT_CHANNELS, FACTORS, FAMILIES, MARKETS, PURPOSES, QUALITIES, SECTORS, classificationPath } from "./cedentesCatalog.js";
import { scopeConflict } from "./cedentesPortfolio.js";

export const NODE_WIDTH = 202;
export const NODE_HEIGHT = 180;
export const COLUMN_GAP = 44;
const ROW_GAP = 22;

export const normalizeName = (value) => String(value || "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").toLowerCase();

export function buildTree(records, { family = "all", showEmpty = false, showBuyers = true } = {}) {
  const root = { id: "portfolio", label: "CARTEIRA", kind: "root", color: "#4f46e5", children: [], recordIds: [] };
  const addNode = (parent, option) => {
    const id = `${parent.id}/${option.code}`;
    let node = parent.children.find((item) => item.id === id);
    if (!node) {
      node = { ...option, id, color: option.color || parent.color, children: [], recordIds: [] };
      parent.children.push(node);
    }
    return node;
  };
  const classifiedFamilies = new Set(records.map((record) => record.family));
  FAMILIES.filter((item) => classifiedFamilies.has(item.code) && (family === "all" || item.code === family)).forEach((item) => {
    const branch = addNode(root, { ...item, kind: "family" });
    if (showEmpty) SECTORS.filter((sector) => sector.family === item.code).forEach((sector) => addNode(branch, { ...sector, kind: "sector" }));
  });
  records.filter((record) => family === "all" || record.family === family).forEach((record) => {
    let parent = root;
    parent.recordIds.push(record.id);
    classificationPath(record).forEach((option) => {
      parent = addNode(parent, option);
      parent.recordIds.push(record.id);
    });
    const entityKey = record.cedenteKey || normalizeName(record.name);
    const existing = !showBuyers && parent.children.find((node) => node.kind === "record" && node.entityKey === entityKey);
    if (existing) existing.recordIds.push(record.id);
    else parent.children.push({ id: `record/${record.id}`, label: record.name, entityKey, kind: "record", color: parent.color, record, recordIds: [record.id], children: [] });
  });
  return root;
}

export function flattenTree(root) {
  return [root, ...root.children.flatMap(flattenTree)];
}

export function layoutTree(root, collapsed = new Set()) {
  let row = 0;
  const nodes = [];
  const edges = [];
  const visit = (node, depth, ancestors) => {
    const column = node.kind === "record" ? 5 : depth;
    const placed = { ...node, depth: column, ancestors, x: 26 + column * (NODE_WIDTH + COLUMN_GAP) };
    nodes.push(placed);
    const children = collapsed.has(node.id) ? [] : node.children;
    if (!children.length) {
      placed.y = 56 + row * (NODE_HEIGHT + ROW_GAP);
      row += 1;
    } else {
      const positioned = children.map((child) => visit(child, depth + 1, [...ancestors, node.id]));
      // Align with the first child: the trunk stays visible at the top of a large tree.
      placed.y = positioned[0].y;
      positioned.forEach((child) => edges.push({ from: placed, to: child }));
    }
    return placed;
  };
  visit(root, 0, []);
  return { nodes, edges, width: Math.max(...nodes.map((node) => node.x)) + NODE_WIDTH + 28, height: 56 + Math.max(row, 1) * (NODE_HEIGHT + ROW_GAP) };
}

export function validateRecord(record) {
  const hasCode = (options, code) => options.some((option) => option.code === code);
  if (!record || typeof record !== "object") return "Cadastro inválido.";
  if (typeof record.name !== "string" || !record.name.trim()) return "Informe o nome do cedente.";
  if (typeof record.parcel !== "string" || !record.parcel.trim()) return "Identifique a parcela, produto ou conjunto de títulos deste caminho.";
  if (record.scope) {
    if (!["cedente", "sacado"].includes(record.scope) || typeof record.cedenteKey !== "string" || !record.cedenteKey) return "Selecione um cedente da carteira e o alcance da classificação.";
    if (record.scope === "sacado" && (!record.sacadoKey || !record.buyer?.trim())) return "Selecione um sacado deste cedente.";
    if (record.scope === "cedente" && (record.sacadoKey || record.buyer)) return "A classificação do cedente inteiro não deve restringir um sacado.";
  }
  if (!hasCode(FAMILIES, record.family)) return "Escolha uma família econômica.";
  if (record.sector && !SECTORS.some((sector) => sector.code === record.sector && sector.family === record.family)) return "O setor deve pertencer à família escolhida.";
  if (record.purpose && (!record.sector || !hasCode(PURPOSES, record.purpose))) return "Selecione um setor antes da finalidade.";
  if (record.purpose === "FIN-K" && !hasCode(CAPEX_REASONS, record.capex)) return "Informe o motivo do CAPEX, mesmo que ainda não identificado.";
  if (record.purpose !== "FIN-K" && record.capex) return "Motivo do CAPEX só se aplica a investimento em ativos.";
  if (record.application && (!record.purpose || !hasCode(APPLICATIONS, record.application))) return "Selecione uma finalidade antes da aplicação.";
  if (record.application === "APL-OUT" && !record.applicationDetail?.trim()) return "Descreva a outra aplicação comprovada para revisão do catálogo.";
  if (!hasCode(CHANNELS, record.channel) || !hasCode(MARKETS, record.market)) return "Canal ou mercado fora do catálogo.";
  if (!QUALITIES.includes(record.quality)) return "Informe a qualidade da classificação.";
  if (record.quality !== "Não identificada" && (!record.source?.trim() || !record.verifiedAt || !record.responsible?.trim())) return "Informe fonte, data de verificação e responsável.";
  for (const attribute of ATTRIBUTES) {
    if (!attribute.options.includes(record[attribute.key])) return `Confira o campo ${attribute.label.toLowerCase()}.`;
  }
  if (!Array.isArray(record.factors)) return "Lista de fatores inválida.";
  if (new Set(record.factors.map((factor) => factor.code)).size !== record.factors.length) return "Um fator não pode se repetir na mesma parcela.";
  for (const factor of record.factors) {
    if (!hasCode(FACTORS, factor.code) || !DIRECTIONS.includes(factor.direction)) return "Fator ou direção fora do catálogo.";
    if (!factor.change?.trim() || !factor.evidence?.trim() || !factor.channels?.length || !factor.channels.every((channel) => EFFECT_CHANNELS.includes(channel))) return "Cada fator precisa de mudança explícita, evidência e canal do efeito.";
  }
  return "";
}

export function emptyRecord() {
  return {
    family: "", sector: "", purpose: "", capex: "", application: "", applicationDetail: "",
    name: "", parcel: "", buyer: "", downstream: "", immediateUse: "",
    scope: "", cedenteKey: "", sacadoKey: "",
    channel: "CAN-NI", market: "MER-NI", quality: "Não identificada",
    source: "", verifiedAt: "", responsible: "", factors: [],
    ...Object.fromEntries(ATTRIBUTES.map((attribute) => [attribute.key, attribute.options.at(-1)])),
  };
}

export function readSavedRecords(storage, key) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return { records: [], error: "" };
    const data = JSON.parse(raw);
    if (data.catalogVersion !== CATALOG_VERSION || !Array.isArray(data.records) || data.records.some((record) => !record.id || record.fictional || validateRecord(record)) || new Set(data.records.map((record) => record.id)).size !== data.records.length) {
      throw new Error("invalid_saved_records");
    }
    return { records: data.records, error: "" };
  } catch {
    return { records: [], error: "Não foi possível ler os cadastros salvos neste navegador. Os dados existentes foram preservados; o salvamento está bloqueado para evitar sobrescrevê-los." };
  }
}

export function findDuplicateParcel(records, candidate) {
  if (candidate.scope) return Boolean(scopeConflict(records, candidate));
  return records.some((record) => record.id !== candidate.id && normalizeName(record.name) === normalizeName(candidate.name) && normalizeName(record.parcel) === normalizeName(candidate.parcel));
}
