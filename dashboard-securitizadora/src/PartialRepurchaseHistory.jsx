import { getOriginalSmartTitle, getPartialRepurchaseEvents, getSmartTitleAmounts } from "./smartPartialRepurchaseRules";

export default function PartialRepurchaseHistory({ row, hideValues = false }) {
  const events = getPartialRepurchaseEvents(row);
  if (!events.length) return null;
  const money = (value) => hideValues ? "R$ -" : Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const date = (value) => value ? String(value).split("T")[0].split("-").reverse().join("/") : "—";
  const original = getOriginalSmartTitle(row);
  const amounts = getSmartTitleAmounts(row);
  return (
    <details style={{ marginTop: 6, minWidth: 240, maxWidth: 360, whiteSpace: "normal", fontSize: 12 }}>
      <summary style={{ cursor: "pointer", color: "#6d28d9", fontWeight: 600 }}>Recompra parcial · Ver histórico</summary>
      <div style={{ marginTop: 8, padding: 12, background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 8 }}>
        <div><strong>Título {row.Dcto}</strong> · OP {row["Borderô"]}</div>
        <div>Valor original: <strong>{money(original.Entrada)}</strong></div>
        <div>Encargos acumulados: <strong>{money(amounts.accumulatedCharges)}</strong></div>
        <div>Saldo em aberto: <strong>{money(amounts.openBalance)}</strong></div>
        <div>Total liquidado na sequência: {money(amounts.accumulatedPaid)}</div>
        <div>Vencimento original: {date(original.Vcto)}</div>
        <div>Deságio original: {money(original.Desagio)}</div>
        {events.map((event) => (
          <div key={event.key} style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid #ddd6fe" }}>
            <strong>Recompra parcial em {date(event.date)}</strong>
            <div>Multa e juros: {money(event.charges)}</div>
            {event.fees > 0 && <div>Tarifas: {money(event.fees)}</div>}
            {event.discount > 0 && <div>Desconto: {money(event.discount)}</div>}
            <div>Total antes da recompra: {money(event.total)}</div>
            <div>Valor liquidado: <strong>{money(event.paid)}</strong></div>
            <div>Saldo após a recompra: {money(event.remaining)}</div>
          </div>
        ))}
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid #ddd6fe" }}>
          <div><strong>{row.Pgto ? "Valor da parcela final" : "Saldo atual"}: {money(row.Entrada)}</strong></div>
          <div>Vencimento atual: {date(row.Vcto)}</div>
          <div>Encargos da parcela atual: {money(row.Encargos)}</div>
          {row.Pgto && <>
            <div>Data da baixa: {date(row.Pgto)}</div>
            <div>Valor liquidado da parcela: <strong>{money(row["Vl Pgto"])}</strong></div>
          </>}
        </div>
      </div>
    </details>
  );
}
