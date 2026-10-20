import SearchableSelect from "./SearchableSelect";
import { availablePortfolioScopes, displayEntityName, formatCapital, resolvePortfolioScope, scopeConflict } from "./cedentesPortfolio.js";

export default function CedentePortfolioPicker({ draft, onChange, portfolio, records, hideValues, onRefresh }) {
  const cedente = portfolio.cedentes.find((item) => item.key === draft.cedenteKey);
  const buyers = cedente?.buyers || [];
  const availableCedentes = availablePortfolioScopes(portfolio, records, draft.id);
  const availableCedente = availableCedentes.find((item) => item.key === draft.cedenteKey);
  const availableBuyers = availableCedente?.availableBuyers || [];
  const resolved = resolvePortfolioScope(draft, portfolio);
  const conflict = scopeConflict(records, draft);
  const label = (entity) => `${entity.name} — ${formatCapital(entity.capitalCents, hideValues)}`;
  const chooseCedente = (key) => {
    const chosen = availableCedentes.find((item) => item.key === key);
    const scope = chosen && !chosen.canClassifyWhole ? "sacado" : draft.scope;
    onChange({ ...draft, scope, cedenteKey: key, name: chosen?.name || "", sacadoKey: "", buyer: "", parcel: scope === "cedente" ? "Todos os sacados do cedente" : "" });
  };
  const chooseBuyer = (key) => {
    const chosen = availableBuyers.find((item) => item.key === key);
    onChange({ ...draft, sacadoKey: key, buyer: chosen?.name || "", parcel: chosen ? `Todos os títulos de ${chosen.name}` : "" });
  };
  return <div className="ct-portfolio-picker">
    {portfolio.status === "loading" && <p className="ct-storage-note" role="status">Carregando cedentes, sacados e capital da carteira…</p>}
    {portfolio.status === "error" && <div className="ct-error" role="alert">{portfolio.error}<br /><button type="button" className="ct-text-button" onClick={onRefresh}>Tentar carregar novamente</button></div>}
    {portfolio.status === "ready" && !portfolio.cedentes.length && <p className="ct-notice">Nenhum cedente disponível na carteira para este usuário.</p>}
    {portfolio.status === "ready" && portfolio.cedentes.length > 0 && !availableCedentes.length && <p className="ct-notice">Não há cedentes ou sacados disponíveis para uma nova classificação. Para mudar um caminho existente, use Editar classificação na árvore.</p>}
    {draft.id && !draft.cedenteKey && <p className="ct-notice">Cadastro anterior: {displayEntityName(draft.name)}. Busque e selecione o cedente para vincular o capital da carteira.</p>}
    <div className="ct-field"><span>Cedente da carteira *</span><SearchableSelect label="Cedente da carteira" value={draft.cedenteKey} disabled={portfolio.status !== "ready" || !availableCedentes.length} onChange={chooseCedente} placeholder="Digite o cedente…" options={[
      ...(draft.cedenteKey && !availableCedente ? [{ value: draft.cedenteKey, label: draft.name, disabled: true, detail: cedente ? "Já classificado" : "Não encontrado na carteira" }] : []),
      ...availableCedentes.map((item) => ({ value: item.key, label: label(item), searchText: item.name }))
    ]} /></div>
    <fieldset className="ct-scope-options"><legend>Esta classificação vale para:</legend>
      {[{ value: "cedente", label: "Cedente inteiro", detail: "Todos os sacados seguem a mesma função. Use uma única classificação para todo o capital do cedente." }, { value: "sacado", label: "Um sacado específico", detail: "Classifique todo o capital desse cedente destinado ao sacado escolhido." }].filter((option) => !draft.cedenteKey || (option.value === "cedente" ? availableCedente?.canClassifyWhole : availableBuyers.length > 0)).map((option) => <label className={`ct-option ${draft.scope === option.value ? "is-selected" : ""}`} key={option.value} style={{ "--branch-color": "#4f46e5" }}><input type="radio" name="scope" value={option.value} checked={draft.scope === option.value} onChange={() => onChange({ ...draft, scope: option.value, sacadoKey: "", buyer: "", parcel: option.value === "cedente" ? "Todos os sacados do cedente" : "" })} /><span><strong>{option.label}</strong><small>{option.detail}</small></span></label>)}
    </fieldset>
    {draft.scope === "sacado" && <div className="ct-field"><span>Sacado do cedente *</span><SearchableSelect label="Sacado do cedente" value={draft.sacadoKey} disabled={!cedente || portfolio.status !== "ready" || !availableBuyers.length} onChange={chooseBuyer} placeholder="Digite o sacado…" options={[
      ...(draft.sacadoKey && !availableBuyers.some((item) => item.key === draft.sacadoKey) ? [{ value: draft.sacadoKey, label: draft.buyer, disabled: true, detail: buyers.some((item) => item.key === draft.sacadoKey) ? "Já classificado" : "Não encontrado neste cedente" }] : []),
      ...availableBuyers.map((item) => ({ value: item.key, label: label(item), searchText: item.name }))
    ]} /></div>}
    {resolved.status === "ready" && <section className="ct-capital-summary" aria-label="Capital do vínculo selecionado"><div><span>Capital em aberto · {draft.scope === "cedente" ? "cedente inteiro" : "cedente → sacado"}</span><strong>{formatCapital(resolved.capitalCents, hideValues)}</strong><small>{resolved.titleCount} títulos em aberto{draft.scope === "cedente" ? ` · ${resolved.buyerCount} sacados na base` : ""}</small></div><dl><div><dt>A vencer</dt><dd>{formatCapital(resolved.notDueCents, hideValues)}</dd></div><div><dt>Vencido</dt><dd>{formatCapital(resolved.overdueCents, hideValues)}</dd></div></dl></section>}
    <p className="ct-help">O capital é a soma do principal em aberto dos títulos a vencer e vencidos, conforme as regras da carteira. Títulos liquidados e recomprados não entram no saldo. O valor acompanha as atualizações da base.</p>
    {conflict && <p className="ct-error" role="alert">{conflict}</p>}
  </div>;
}
