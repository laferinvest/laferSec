import { supabase } from "./supabaseClient.js";

const overdueValue = (data, keys) => data.delinquency
  .filter((item) => keys.includes(item.key))
  .reduce((sum, item) => sum + item.value, 0);

const leaderSnapshot = (stats, fallback = "Carteira") => ({
  entityKey: stats?.items?.[0]?.key || "portfolio",
  entityLabel: stats?.items?.[0]?.label || fallback,
});

const RETIRED_RISK_LIMIT_KEYS = [
  "cedente_top1_portfolio",
  "cedente_top5_portfolio",
  "sacado_top1_portfolio",
  "sacado_top5_portfolio",
];

export const RISK_LIMIT_DEFINITIONS = [
  {
    key: "cedente_top1_pl",
    label: "Maior cedente / PL",
    unit: "percent",
    suggestedWarning: 20,
    suggestedCritical: 25,
    action: "Suspender o aumento da exposição e revisar imediatamente o limite do grupo cedente.",
    snapshot: (data) => ({ value: data.cedenteStats.top1Pl, ...leaderSnapshot(data.cedenteStats) }),
  },
  {
    key: "cedente_top5_pl",
    label: "Top 5 cedentes / PL",
    unit: "percent",
    suggestedWarning: 60,
    suggestedCritical: 75,
    action: "Reavaliar a distribuição da originação entre cedentes.",
    snapshot: (data) => ({ value: data.cedenteStats.top5Pl, entityKey: "portfolio", entityLabel: "Carteira" }),
  },
  {
    key: "sacado_top1_pl",
    label: "Maior sacado / PL",
    unit: "percent",
    suggestedWarning: 10,
    suggestedCritical: 15,
    action: "Bloquear aumento de exposição e revisar o risco do sacado.",
    snapshot: (data) => ({ value: data.sacadoStats.top1Pl, ...leaderSnapshot(data.sacadoStats) }),
  },
  {
    key: "sacado_top5_pl",
    label: "Top 5 sacados / PL",
    unit: "percent",
    suggestedWarning: 35,
    suggestedCritical: 50,
    action: "Diversificar sacados e revisar operações em análise.",
    snapshot: (data) => ({ value: data.sacadoStats.top5Pl, entityKey: "portfolio", entityLabel: "Carteira" }),
  },
  {
    key: "hhi_cedente",
    label: "HHI por cedente",
    configLabel: "Ticket médio alvo por cedente",
    unit: "hhi",
    inputUnit: "currency",
    thresholdFormula: "ticketOverPl",
    alertMode: "attentionOnly",
    suggestedWarning: 150000,
    action: "Revisar a pulverização da carteira entre cedentes.",
    snapshot: (data) => ({ value: data.cedenteStats.hhi, entityKey: "portfolio", entityLabel: "Carteira" }),
  },
  {
    key: "hhi_sacado",
    label: "HHI por sacado",
    configLabel: "Ticket médio alvo por sacado",
    unit: "hhi",
    inputUnit: "currency",
    thresholdFormula: "ticketOverPl",
    alertMode: "attentionOnly",
    suggestedWarning: 150000,
    action: "Revisar a pulverização da carteira entre sacados.",
    snapshot: (data) => ({ value: data.sacadoStats.hhi, entityKey: "portfolio", entityLabel: "Carteira" }),
  },
  {
    key: "overdue_30_portfolio",
    label: "Atraso acima de 30 dias / carteira",
    unit: "percent",
    suggestedWarning: 5,
    suggestedCritical: 10,
    action: "Analisar cedentes e sacados afetados e definir plano de cobrança.",
    snapshot: (data) => ({
      value: data.totalOpen > 0 ? overdueValue(data, ["31-60", "61-90", "90+"]) / data.totalOpen : 0,
      entityKey: "portfolio",
      entityLabel: "Carteira",
    }),
  },
  {
    key: "overdue_90_portfolio",
    label: "Atraso acima de 90 dias / carteira",
    unit: "percent",
    suggestedWarning: 2,
    suggestedCritical: 5,
    action: "Revisar cobrança, recuperação, garantias e possibilidade de recompra.",
    snapshot: (data) => ({
      value: data.totalOpen > 0 ? overdueValue(data, ["90+"]) / data.totalOpen : 0,
      entityKey: "portfolio",
      entityLabel: "Carteira",
    }),
  },
];

export function getRiskMetricSnapshots(data) {
  return RISK_LIMIT_DEFINITIONS.map((definition) => ({
    ...definition,
    ...definition.snapshot(data),
  }));
}

export function limitToInputValue(value, unit) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  return unit === "currency" ? numeric : numeric * 100;
}

export function inputToLimitValue(value, unit) {
  if (value === "" || value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return unit === "currency" ? numeric : numeric / 100;
}

export function getRiskAlertLevel(definition, currentValue, warningValue, criticalValue) {
  if (!Number.isFinite(currentValue)) return null;
  if (definition?.alertMode === "attentionOnly") {
    return Number.isFinite(warningValue) && currentValue >= warningValue ? "attention" : null;
  }
  if (definition?.alertMode === "criticalOnly") {
    return Number.isFinite(criticalValue) && currentValue >= criticalValue ? "critical" : null;
  }
  if (!Number.isFinite(warningValue) || currentValue < warningValue) return null;
  return Number.isFinite(criticalValue) && currentValue >= criticalValue ? "critical" : "attention";
}

export function deriveHhiTarget(ticketValue, patrimonio) {
  const ticket = Number(ticketValue);
  const capital = Number(patrimonio);
  if (!Number.isFinite(ticket) || ticket <= 0 || !Number.isFinite(capital) || capital <= 0) return null;
  return {
    ticket,
    effectiveNames: capital / ticket,
    hhi: ticket / capital,
  };
}

export function evaluateRiskLimit(definition, currentValue, limit, data) {
  const current = Number(currentValue);
  if (!definition || !limit || !Number.isFinite(current)) return { level: null, thresholdValue: null };

  if (definition.thresholdFormula === "ticketOverPl" && limit.unit === "currency") {
    const target = deriveHhiTarget(limit.warning_value, data?.patrimonio);
    if (!target) return { level: null, thresholdValue: null };
    return {
      level: current > target.hhi ? "attention" : null,
      thresholdValue: target.hhi,
      target,
    };
  }

  const warningValue = Number(limit.warning_value);
  const criticalValue = Number(limit.critical_value);
  const level = getRiskAlertLevel(definition, current, warningValue, criticalValue);
  return {
    level,
    thresholdValue: level === "critical" ? criticalValue : warningValue,
  };
}

export async function loadRiskWorkflow() {
  const [limitsResult, alertsResult, actionsResult] = await Promise.all([
    supabase.from("risk_limits").select("*").order("label"),
    supabase.from("risk_alerts").select("*").order("last_seen_at", { ascending: false }),
    supabase.from("risk_actions").select("*").order("created_at", { ascending: false }),
  ]);
  const error = limitsResult.error || alertsResult.error || actionsResult.error;
  if (error) throw error;
  const supportedKeys = new Set(RISK_LIMIT_DEFINITIONS.map((definition) => definition.key));
  return {
    limits: (limitsResult.data || []).filter((limit) => supportedKeys.has(limit.metric_key)),
    alerts: (alertsResult.data || []).filter((alert) => supportedKeys.has(alert.metric_key)),
    actions: actionsResult.data || [],
  };
}

export async function saveRiskLimits(drafts, userId) {
  const now = new Date().toISOString();
  const payload = RISK_LIMIT_DEFINITIONS.map((definition) => {
    const draft = drafts[definition.key];
    const inputUnit = definition.inputUnit || definition.unit;
    const draftWarning = inputToLimitValue(draft?.warning, inputUnit);
    const draftCritical = inputToLimitValue(draft?.critical, inputUnit);
    const warningValue = definition.alertMode === "criticalOnly" ? draftCritical : draftWarning;
    const criticalValue = definition.alertMode === "attentionOnly" ? draftWarning : draftCritical;
    if (warningValue === null || criticalValue === null || warningValue < 0 || criticalValue < warningValue) {
      throw new Error(`Revise os limites de ${definition.label}. O crítico deve ser maior ou igual ao de atenção.`);
    }
    return {
      metric_key: definition.key,
      label: definition.label,
      unit: inputUnit,
      warning_value: warningValue,
      critical_value: criticalValue,
      enabled: draft?.enabled !== false,
      updated_by: userId,
      updated_at: now,
    };
  });

  const { data, error } = await supabase
    .from("risk_limits")
    .upsert(payload, { onConflict: "metric_key" })
    .select();
  if (error) throw error;

  const { error: retireError } = await supabase
    .from("risk_limits")
    .update({ enabled: false, updated_by: userId, updated_at: now })
    .in("metric_key", RETIRED_RISK_LIMIT_KEYS);
  if (retireError) throw retireError;

  return data || [];
}

export async function syncRiskWorkflow(data, limits, userId) {
  const snapshots = new Map(getRiskMetricSnapshots(data).map((item) => [item.key, item]));
  const definitionByKey = new Map(RISK_LIMIT_DEFINITIONS.map((definition) => [definition.key, definition]));
  const { data: existingAlerts, error: existingError } = await supabase.from("risk_alerts").select("*");
  if (existingError) throw existingError;

  const existingByKey = new Map((existingAlerts || []).map((alert) => [alert.alert_key, alert]));
  const now = new Date().toISOString();
  const activePayload = [];

  limits.filter((limit) => limit.enabled).forEach((limit) => {
    const snapshot = snapshots.get(limit.metric_key);
    const definition = definitionByKey.get(limit.metric_key);
    if (!snapshot || !definition || snapshot.value === null || snapshot.value === undefined) return;
    const currentValue = Number(snapshot?.value);
    const evaluation = evaluateRiskLimit(definition, currentValue, limit, data);
    const level = evaluation.level;
    if (!level) return;

    const existing = existingByKey.get(limit.metric_key);
    activePayload.push({
      alert_key: limit.metric_key,
      limit_id: limit.id,
      metric_key: limit.metric_key,
      title: limit.label,
      entity_key: snapshot.entityKey,
      entity_label: snapshot.entityLabel,
      level,
      current_value: currentValue,
      threshold_value: evaluation.thresholdValue,
      status: existing?.status && existing.status !== "resolved" ? existing.status : "open",
      detected_at: existing?.status && existing.status !== "resolved" ? existing.detected_at : now,
      last_seen_at: now,
      resolved_at: null,
      updated_by: userId,
      updated_at: now,
    });
  });

  if (activePayload.length > 0) {
    const { error } = await supabase.from("risk_alerts").upsert(activePayload, { onConflict: "alert_key" });
    if (error) throw error;
  }

  const activeKeys = new Set(activePayload.map((alert) => alert.alert_key));
  const idsToResolve = (existingAlerts || [])
    .filter((alert) => alert.status !== "resolved" && !activeKeys.has(alert.alert_key))
    .map((alert) => alert.id);
  if (idsToResolve.length > 0) {
    const { error } = await supabase
      .from("risk_alerts")
      .update({ status: "resolved", resolved_at: now, updated_by: userId, updated_at: now })
      .in("id", idsToResolve);
    if (error) throw error;
  }

  const { data: refreshedAlerts, error: alertsError } = await supabase
    .from("risk_alerts")
    .select("*")
    .order("last_seen_at", { ascending: false });
  if (alertsError) throw alertsError;

  const activeAlerts = (refreshedAlerts || []).filter((alert) => alert.status !== "resolved");
  if (activeAlerts.length > 0) {
    const actionPayload = activeAlerts.map((alert) => ({
      alert_id: alert.id,
      description: definitionByKey.get(alert.metric_key)?.action || "Analisar o alerta e registrar a providência adotada.",
      created_by: userId,
      updated_by: userId,
    }));
    const { error } = await supabase
      .from("risk_actions")
      .upsert(actionPayload, { onConflict: "alert_id", ignoreDuplicates: true });
    if (error) throw error;
  }

  const { data: refreshedActions, error: actionsError } = await supabase
    .from("risk_actions")
    .select("*")
    .order("created_at", { ascending: false });
  if (actionsError) throw actionsError;
  return { limits, alerts: refreshedAlerts || [], actions: refreshedActions || [] };
}

export async function updateRiskAction(actionId, patch, userId) {
  const { data, error } = await supabase
    .from("risk_actions")
    .update({ ...patch, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", actionId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
