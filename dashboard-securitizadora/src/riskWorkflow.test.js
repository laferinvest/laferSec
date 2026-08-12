import test from "node:test";
import assert from "node:assert/strict";

import {
  RISK_LIMIT_DEFINITIONS,
  deriveHhiTarget,
  evaluateRiskLimit,
  getRiskAlertLevel,
  getRiskMetricSnapshots,
  inputToLimitValue,
  limitToInputValue,
} from "./riskWorkflow.js";

test("converte percentuais da tela para a escala persistida", () => {
  assert.equal(inputToLimitValue(25, "percent"), 0.25);
  assert.equal(inputToLimitValue(12.5, "hhi"), 0.125);
  assert.equal(inputToLimitValue("", "percent"), null);
  assert.equal(limitToInputValue(0.3, "percent"), 30);
});

test("calcula métricas de atraso e concentração para os limites", () => {
  const data = {
    totalOpen: 1000,
    cedenteStats: { top1Pl: 0.08, top5Pl: 0.24, hhi: 0.14, items: [{ key: "grp-a", label: "Grupo A" }] },
    sacadoStats: { top1Pl: 0.04, top5Pl: 0.16, hhi: 0.09, items: [{ key: "sac-a", label: "Sacado A" }] },
    delinquency: [
      { key: "31-60", value: 40 },
      { key: "61-90", value: 20 },
      { key: "90+", value: 10 },
    ],
  };
  const snapshots = new Map(getRiskMetricSnapshots(data).map((item) => [item.key, item]));

  assert.equal(snapshots.get("cedente_top1_pl").value, 0.08);
  assert.equal(snapshots.get("cedente_top1_pl").entityLabel, "Grupo A");
  assert.equal(snapshots.get("cedente_top5_pl").value, 0.24);
  assert.equal(snapshots.get("sacado_top1_pl").value, 0.04);
  assert.equal(snapshots.get("sacado_top5_pl").value, 0.16);
  assert.equal(snapshots.has("cedente_top1_portfolio"), false);
  assert.equal(snapshots.get("overdue_30_portfolio").value, 0.07);
  assert.equal(snapshots.get("overdue_90_portfolio").value, 0.01);
});

test("concentrações sobre o PL possuem faixas de atenção e crítico", () => {
  const definitions = new Map(RISK_LIMIT_DEFINITIONS.map((definition) => [definition.key, definition]));

  assert.equal(getRiskAlertLevel(definitions.get("cedente_top1_pl"), 0.19, 0.20, 0.25), null);
  assert.equal(getRiskAlertLevel(definitions.get("cedente_top1_pl"), 0.21, 0.20, 0.25), "attention");
  assert.equal(getRiskAlertLevel(definitions.get("cedente_top1_pl"), 0.25, 0.20, 0.25), "critical");
  assert.equal(getRiskAlertLevel(definitions.get("sacado_top5_pl"), 0.40, 0.35, 0.50), "attention");
  assert.equal(getRiskAlertLevel(definitions.get("overdue_30_portfolio"), 0.07, 0.05, 0.10), "attention");
  assert.equal(getRiskAlertLevel(definitions.get("overdue_30_portfolio"), 0.12, 0.05, 0.10), "critical");
});

test("deriva o HHI máximo do ticket médio e do PL alocável", () => {
  const target = deriveHhiTarget(150000, 2100000);
  assert.equal(target.effectiveNames, 14);
  assert.equal(target.hhi, 1 / 14);

  const definition = RISK_LIMIT_DEFINITIONS.find((item) => item.key === "hhi_cedente");
  const limit = { unit: "currency", warning_value: 150000, critical_value: 150000 };
  assert.equal(evaluateRiskLimit(definition, 0.07, limit, { patrimonio: 2100000 }).level, null);
  const evaluation = evaluateRiskLimit(definition, 0.08, limit, { patrimonio: 2100000 });
  assert.equal(evaluation.level, "attention");
  assert.equal(evaluation.thresholdValue, 1 / 14);
});
