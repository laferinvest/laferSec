import { applyPortfolioStatuses, isValidPortfolioRow, parseIsoDateLocal } from "./portfolioRiskRules.js";

export function getRiskReferenceDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function calculateRiskExposure(rows, referenceDay = getRiskReferenceDay()) {
  const today = parseIsoDateLocal(referenceDay);
  if (!today) throw new Error("Data de referência inválida.");
  const eligible = rows.filter((row) => isValidPortfolioRow(row) && row.Entrada > 0);
  const allRows = applyPortfolioStatuses(eligible, today);
  const openRows = allRows.filter((row) => ["aVencer", "atraso"].includes(row._status));
  const totalOpen = openRows.reduce((sum, row) => sum + row.Entrada, 0);
  const overdueRows = openRows.filter((row) => row._status === "atraso");
  const totalOverdue = overdueRows.reduce((sum, row) => sum + row.Entrada, 0);
  return { allRows, openRows, totalOpen, totalOverdue, referenceDate: today,
    overdueCount: overdueRows.length, ratio: totalOpen > 0 ? totalOverdue / totalOpen : null };
}

// O banco calcula os totais e a data; o navegador não envia valores nem datas.
export async function recordRiskDelayHistory(client) {
  const { data, error } = await client.rpc("registrar_historico_atraso");
  if (error) throw new Error(error.message || "Não foi possível salvar o histórico de atraso.");
  if (!data) throw new Error("O banco não confirmou o registro do histórico de atraso.");
  return data;
}

export async function loadRiskDelayHistory(client) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from("risk_delay_history")
      .select("data_referencia,exposicao_vencida,exposicao_aberto,percentual_atraso,calculado_em")
      .order("data_referencia", { ascending: false }).range(from, from + 999);
    if (error) throw new Error(error.message || "Não foi possível carregar o histórico de atraso.");
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows.reverse().map((row) => ({ ...row,
    percentual_atraso: row.percentual_atraso === null ? null : Number(row.percentual_atraso),
    exposicao_vencida: Number(row.exposicao_vencida), exposicao_aberto: Number(row.exposicao_aberto),
  }));
}
