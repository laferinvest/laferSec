import test from "node:test";
import assert from "node:assert/strict";
import { APPLICATIONS, CAPEX_REASONS, CATALOG_VERSION, FACTORS, FAMILIES, PURPOSES, SECTORS, classificationPath } from "./cedentesCatalog.js";
import { NODE_HEIGHT, NODE_WIDTH, buildTree, emptyRecord, findDuplicateParcel, flattenTree, layoutTree, readSavedRecords, validateRecord } from "./cedentesTree.js";

const sample = (overrides = {}) => ({ ...emptyRecord(), id: "test-1", name: "Cedente de teste", parcel: "Parcela A", family: "FAM-A", sector: "SET-A1", purpose: "FIN-I", application: "APL-EMB", ...overrides });
const foodCases = [
  sample({ id: "food-1", purpose: "FIN-K", capex: "CAP-EXP", application: "APL-EQP" }),
  sample({ id: "food-2", application: "APL-EMB" }),
  sample({ id: "food-3", purpose: "FIN-M", application: "APL-REP" }),
];
const autoCases = [
  sample({ id: "auto-1", name: "Aurora Máquinas", parcel: "Peças novas", family: "FAM-F", sector: "SET-F1", application: "APL-COM" }),
  sample({ id: "auto-2", name: "Aurora Máquinas", parcel: "Reposição", family: "FAM-F", sector: "SET-F1", purpose: "FIN-M", application: "APL-REP" }),
  sample({ id: "auto-3", name: "Rota Transportes", parcel: "Frete", family: "FAM-F", sector: "SET-F1", purpose: "FIN-S", application: "APL-SER" }),
];

test("catálogo preserva opções fechadas e famílias automáticas", () => {
  assert.equal(FAMILIES.length, 8);
  assert.equal(SECTORS.length, 30);
  assert.equal(PURPOSES.length, 6);
  assert.equal(CAPEX_REASONS.length, 6);
  assert.equal(APPLICATIONS.length, 15);
  assert.equal(FACTORS.length, 15);
  const codes = [...FAMILIES, ...SECTORS, ...PURPOSES, ...CAPEX_REASONS, ...APPLICATIONS, ...FACTORS].map((item) => item.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(SECTORS.every((sector) => FAMILIES.some((family) => family.code === sector.family)));
});

test("reproduz os três caminhos de alimentos e separa o motivo do CAPEX nos dados", () => {
  const food = foodCases;
  assert.deepEqual(food.map((record) => classificationPath(record).slice(2).map((part) => part.label)), [
    ["CAPEX de expansão", "Equipamento completo"],
    ["Insumo da produção corrente", "Embalagem"],
    ["Manutenção e reposição rotineiras", "Peça de reposição rotineira"],
  ]);
  assert.equal(food[0].purpose, "FIN-K");
  assert.equal(food[0].capex, "CAP-EXP");
});

test("casos econômicos de referência seguem as regras de cadastro", () => {
  [...foodCases, ...autoCases].forEach((record) => assert.equal(validateRecord(record), "", record.name));
});

test("agrupa cedentes diferentes na mesma cadeia e permite parcelas distintas do mesmo cedente", () => {
  const tree = buildTree(autoCases);
  assert.equal(tree.recordIds.length, autoCases.length);
  const nodes = flattenTree(tree);
  const auto = nodes.find((node) => node.code === "SET-F1");
  assert.equal(auto.recordIds.length, 3);
  assert.equal(nodes.filter((node) => node.kind === "record" && node.label === "Aurora Máquinas").length, 2);
  for (const node of nodes.filter((item) => item.children.length)) {
    assert.deepEqual([...node.recordIds].sort(), node.children.flatMap((child) => child.recordIds).sort());
    assert.equal(new Set(node.recordIds).size, node.recordIds.length);
  }
});

test("classificação parcial fica no último nível comprovado sem inventar setor ou finalidade", () => {
  const record = sample({ sector: "", purpose: "", application: "" });
  assert.equal(validateRecord(record), "");
  assert.deepEqual(classificationPath(record).map((part) => part.code), ["FAM-A"]);
  const family = buildTree([record]).children.find((node) => node.code === "FAM-A");
  assert.equal(family.children[0].kind, "record");
  assert.equal(classificationPath(sample({ family: "FAM-Z", sector: "SET-Z1", purpose: "FIN-U", application: "APL-NI" })).length, 4);
});

test("rejeita setor incompatível e finalidade sem setor", () => {
  assert.match(validateRecord(sample({ sector: "SET-C1" })), /família/);
  assert.match(validateRecord(sample({ sector: "" })), /setor/);
});

test("CAPEX exige motivo explícito e não contamina finalidades operacionais", () => {
  assert.match(validateRecord(sample({ purpose: "FIN-K" })), /motivo/);
  assert.equal(validateRecord(sample({ purpose: "FIN-K", capex: "CAP-NI" })), "");
  assert.match(validateRecord(sample({ purpose: "FIN-M", capex: "CAP-EXP" })), /só se aplica/);
});

test("outra aplicação exige descrição e fatores exigem mudança, direção, canal e evidência", () => {
  assert.match(validateRecord(sample({ application: "APL-OUT" })), /Descreva/);
  assert.equal(validateRecord(sample({ application: "APL-OUT", applicationDetail: "Aplicação a revisar" })), "");
  const factor = { code: "FAT-MOE", change: "Alta do dólar", direction: "Adversa", channels: ["Custo"], evidence: "Contrato de compra em dólar" };
  assert.equal(validateRecord(sample({ factors: [factor] })), "");
  assert.match(validateRecord(sample({ factors: [{ ...factor, evidence: "" }] })), /evidência/);
  assert.match(validateRecord(sample({ factors: [factor, factor] })), /repetir/);
  assert.match(validateRecord(sample({ quality: "Documentada" })), /fonte/);
});

test("não duplica a mesma parcela em destinos exclusivos", () => {
  const original = sample();
  assert.equal(findDuplicateParcel([original], sample({ id: undefined, name: " CEDENTE de teste ", family: "FAM-C", sector: "SET-C1" })), true);
  assert.equal(findDuplicateParcel([original], sample({ id: undefined, parcel: "Parcela B" })), false);
  assert.equal(findDuplicateParcel([original], original), false);
});

test("famílias sem classificações ficam ocultas, inclusive ao mostrar setores vazios", () => {
  const tree = buildTree([], { showEmpty: true });
  assert.equal(tree.children.length, 0);
  assert.equal(tree.recordIds.length, 0);
  assert.equal(flattenTree(tree).filter((node) => node.kind === "record").length, 0);
  for (const showEmpty of [false, true]) {
    const populated = buildTree([sample()], { showEmpty });
    assert.deepEqual(populated.children.map((node) => node.code), ["FAM-A"]);
    assert.equal(populated.children[0].recordIds.length, 1);
    assert.equal(flattenTree(populated).filter((node) => node.kind === "sector").length, showEmpty ? 6 : 1);
  }
  const partial = sample({ family: "FAM-B", sector: "", purpose: "", application: "" });
  assert.deepEqual(buildTree([partial]).children.map((node) => node.code), ["FAM-B"]);
});

test("layout mantém nós legíveis, sem sobreposição, inclusive em classificações parciais", () => {
  const tree = buildTree([...autoCases, sample({ sector: "", purpose: "", application: "" })], { showEmpty: true });
  const layout = layoutTree(tree);
  for (const node of layout.nodes) {
    assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
    assert.ok(node.x + NODE_WIDTH < layout.width);
    assert.ok(node.y + NODE_HEIGHT < layout.height);
    const others = layout.nodes.filter((item) => item.x === node.x && item.id !== node.id);
    assert.ok(others.every((other) => Math.abs(node.y - other.y) >= NODE_HEIGHT));
  }
  assert.equal(layout.nodes.find((node) => node.id === "record/test-1").depth, 5);
  const collapsed = layoutTree(tree, new Set(tree.children.map((node) => node.id)));
  assert.equal(collapsed.nodes.length, 3);
});

test("leitura local preserva erros de armazenamento e não aceita registros fictícios", () => {
  const store = (value) => ({ getItem: () => value });
  assert.deepEqual(readSavedRecords(store(null), "user-a"), { records: [], error: "" });
  const valid = JSON.stringify({ catalogVersion: CATALOG_VERSION, records: [sample()] });
  assert.equal(readSavedRecords(store(valid), "user-a").records.length, 1);
  for (const value of ["{bad json", JSON.stringify({ catalogVersion: "old", records: [] }), JSON.stringify({ catalogVersion: CATALOG_VERSION, records: [sample({ fictional: true })] })]) {
    assert.ok(readSavedRecords(store(value), "user-a").error);
  }
  assert.ok(readSavedRecords({ getItem() { throw new Error("blocked"); } }, "user-a").error);
});
