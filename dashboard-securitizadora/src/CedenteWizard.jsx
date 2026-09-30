import { useEffect, useRef, useState } from "react";
import { APPLICATIONS, CAPEX_REASONS, FAMILIES, PURPOSES, SECTORS, classificationPath } from "./cedentesCatalog.js";
// * Para reativar a etapa de contexto, importar também ATTRIBUTES, CHANNELS,
// * DIRECTIONS, EFFECT_CHANNELS, FACTORS, MARKETS e QUALITIES de cedentesCatalog.js.
import { emptyRecord, validateRecord } from "./cedentesTree.js";
import { bindPortfolioScope, formatCapital, resolvePortfolioScope, scopeConflict } from "./cedentesPortfolio.js";
import CedentePortfolioPicker from "./CedentePortfolioPicker.jsx";

const QUESTIONS = {
  family: { title: "Qual é a família econômica de destino desta venda?", help: "Pense na cadeia que usa o produto ou serviço, até onde houver evidência. A atividade do cedente pode ser diferente do destino econômico da venda." },
  sector: { title: "Dentro dessa família, qual é o setor de destino?", help: "Uma máquina para uma fábrica de alimentos pertence a Alimentos e bebidas. Se o destino posterior não estiver comprovado, mantenha apenas o que você sabe." },
  purpose: { title: "Qual é a finalidade econômica dessa compra?", help: "Considere o uso pelo comprador ou usuário econômico identificado. CAPEX se refere ao investimento desse usuário, que pode estar depois do sacado na cadeia." },
  capex: { title: "Qual é o motivo do investimento?", help: "Uma máquina nova pode substituir outra ou melhorar a eficiência. Só selecione expansão quando houver evidência de aumento de capacidade." },
  application: { title: "Como o produto ou serviço é aplicado?", help: "Escolha a aplicação dos títulos selecionados. Se houver mais de uma aplicação e não for possível separar, use Múltiplas aplicações sem abertura." },
  identity: { title: "Qual cedente você quer classificar?", help: "Escolha um cedente da carteira. A classificação pode valer para todos os sacados dele ou para todo o capital destinado a um sacado específico." },
  // * Etapa de contexto preservada para uma futura análise complementar:
  // context: { title: "O que você já sabe sobre essa cadeia?", help: "Preencha apenas o que estiver identificado. Os campos desconhecidos continuam explícitos e você poderá editar o cadastro depois." },
  review: { title: "Confira o caminho antes de adicionar", help: "Confira se este caminho vale para o alcance escolhido: o cedente inteiro ou todos os títulos destinados ao sacado selecionado." },
};

/* * Campos de contexto preservados para reativação futura.
function SelectField({ label, value, onChange, options }) {
  return <label className="ct-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => {
    const code = typeof option === "string" ? option : option.code;
    return <option key={code} value={code}>{typeof option === "string" ? option : option.label}</option>;
  })}</select></label>;
}
*/

export default function CedenteWizard({ initialRecord, records, portfolio, onRefreshPortfolio, hideValues, onClose, onSave, saveBlocked }) {
  const [draft, setDraft] = useState(() => ({ ...emptyRecord(), ...initialRecord, scope: initialRecord.scope || "cedente", ...(!initialRecord.scope ? { buyer: "", sacadoKey: "" } : {}) }));
  const [step, setStep] = useState("identity");
  const [visitedSteps, setVisitedSteps] = useState([]);
  const [error, setError] = useState("");
  const dialog = useRef(null);
  const heading = useRef(null);
  const body = useRef(null);
  const steps = ["identity", "family", "sector", "purpose", ...(draft.purpose === "FIN-K" ? ["capex"] : []), "application", "review"];
  const index = steps.indexOf(step);
  const path = classificationPath(draft);
  const question = QUESTIONS[step];
  const resolvedScope = resolvePortfolioScope(draft, portfolio);
  const choices = step === "family" ? FAMILIES : step === "sector" ? SECTORS.filter((sector) => sector.family === draft.family) : step === "purpose" ? PURPOSES : step === "capex" ? CAPEX_REASONS : step === "application" ? APPLICATIONS : null;

  useEffect(() => {
    const element = dialog.current;
    const returnFocus = document.activeElement;
    element.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      returnFocus?.focus();
    };
  }, []);
  useEffect(() => {
    heading.current?.focus();
    body.current?.scrollTo({ top: 0 });
  }, [step]);

  const update = (key, value) => {
    setError("");
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const choose = (value) => {
    setError("");
    setDraft((current) => {
      if (current[step] === value) return current;
      const next = { ...current, [step]: value };
      if (step === "family") Object.assign(next, { sector: "", purpose: "", capex: "", application: "", applicationDetail: "" });
      if (step === "sector") Object.assign(next, { purpose: "", capex: "", application: "", applicationDetail: "" });
      if (step === "purpose") Object.assign(next, { capex: "", application: "", applicationDetail: "" });
      if (step === "application" && value !== "APL-OUT") next.applicationDetail = "";
      return next;
    });
  };
  const go = (next) => { setError(""); setVisitedSteps((current) => [...current, step]); setStep(next); };
  const goBack = () => {
    if (!visitedSteps.length) return onClose();
    setError("");
    setStep(visitedSteps.at(-1));
    setVisitedSteps((current) => current.slice(0, -1));
  };
  const stopHere = () => {
    setDraft((current) => ({ ...current,
      ...(step === "sector" ? { sector: "", purpose: "", capex: "" } : {}),
      ...(step === "purpose" ? { purpose: "", capex: "" } : {}),
      application: "", applicationDetail: "",
    }));
    go("review");
  };
  const submit = async (event) => {
    event.preventDefault();
    if (choices && !draft[step]) return setError("Selecione uma opção para continuar.");
    if (step === "application" && draft.application === "APL-OUT" && !draft.applicationDetail.trim()) return setError("Descreva a aplicação para revisão do catálogo.");
    if (step === "identity") {
      const bound = bindPortfolioScope(draft, portfolio);
      if (bound.error) return setError(bound.error);
      const conflict = scopeConflict(records, bound.record);
      if (conflict) return setError(conflict);
      setDraft(bound.record);
    }
    if (step === "review") {
      const validation = validateRecord(draft);
      if (validation) return setError(validation);
    }
    if (step === "review") {
      const saveError = await onSave(draft);
      if (saveError) setError(saveError);
    } else go(steps[index + 1]);
  };
  // * Apoio à etapa de contexto, mantido para uso futuro:
  // const updateFactor = (code, key, value) => update("factors", draft.factors.map((factor) => factor.code === code ? { ...factor, [key]: value } : factor));

  return <dialog ref={dialog} className="ct-dialog" aria-labelledby="ct-wizard-heading" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <form onSubmit={submit}>
      <header className="ct-dialog-header">
        <div><span className="ct-eyebrow">{draft.id ? "Editar classificação" : "Adicionar cedente"}</span><p>Uma ramificação de cada vez</p></div>
        <button type="button" className="ct-icon-button" aria-label="Fechar cadastro" onClick={onClose}>×</button>
      </header>
      <div className="ct-progress" aria-label={`Etapa ${index + 1} de ${steps.length}`}><span style={{ width: `${((index + 1) / steps.length) * 100}%` }} /></div>
      <div className="ct-dialog-body" ref={body}>
        <span className="ct-eyebrow">{step === "family" ? "Primeira ramificação" : `Etapa ${index + 1} de ${steps.length}`}</span>
        <h2 id="ct-wizard-heading" tabIndex={-1} ref={heading}>{question.title}</h2>
        <p className="ct-question-help">{question.help}</p>
        {step !== "family" && path.length > 0 && <ol className="ct-breadcrumb" aria-label="Caminho selecionado">{path.map((part) => <li key={part.code}>{part.label}</li>)}</ol>}

        {step === "family" && <div className="ct-example-note"><strong>Por exemplo</strong><span>Uma empresa que fabrica máquinas para a indústria de alimentos entra em <b>Consumo e serviços às pessoas</b>.</span></div>}
        {choices && <fieldset className={`ct-options ${step === "application" ? "ct-options-compact" : ""}`}><legend className="ct-sr-only">{question.title}</legend>
          {choices.map((option) => <label key={option.code} className={`ct-option ${draft[step] === option.code ? "is-selected" : ""}`} style={{ "--branch-color": option.color || "#4f46e5" }}>
            <input type="radio" name={step} value={option.code} checked={draft[step] === option.code} onChange={() => choose(option.code)} />
            <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
          </label>)}
        </fieldset>}
        {step === "application" && draft.application === "APL-OUT" && <label className="ct-field"><span>Descreva a aplicação comprovada</span><textarea value={draft.applicationDetail} maxLength={1000} onChange={(event) => update("applicationDetail", event.target.value)} /><small>Essa descrição ficará sinalizada para revisão do catálogo.</small></label>}
        {["sector", "purpose", "application"].includes(step) && <button type="button" className="ct-text-button ct-stop" onClick={stopHere}>Ainda não sei. Classificar só até o nível anterior →</button>}

        {step === "identity" && <CedentePortfolioPicker draft={draft} onChange={(next) => { setError(""); setDraft(next); }} portfolio={portfolio} records={records} hideValues={hideValues} onRefresh={onRefreshPortfolio} />}

        {/* * Formulário de contexto preservado para uma futura etapa opcional.
        {step === "context" && <div className="ct-context-form">
          <section><h3>Outros elos da cadeia</h3><div className="ct-form-grid">
            <label className="ct-field"><span>Usuário ou pagador posterior</span><input value={draft.downstream} maxLength={240} onChange={(event) => update("downstream", event.target.value)} placeholder="De quem o sacado depende?" /></label>
            <label className="ct-field"><span>Uso imediato do produto</span><input value={draft.immediateUse} maxLength={240} onChange={(event) => update("immediateUse", event.target.value)} placeholder="Ex.: componente incorporado a uma máquina" /></label>
          </div></section>
          <section><h3>Evidência da classificação</h3><div className="ct-form-grid">
            <SelectField label="Qualidade da classificação" value={draft.quality} options={QUALITIES} onChange={(value) => update("quality", value)} />
            <label className="ct-field"><span>Data de verificação</span><input type="date" value={draft.verifiedAt} onChange={(event) => update("verifiedAt", event.target.value)} /></label>
            <label className="ct-field"><span>Fonte / documento</span><input value={draft.source} maxLength={500} onChange={(event) => update("source", event.target.value)} placeholder="Ex.: pedido de compra, contrato ou declaração" /></label>
            <label className="ct-field"><span>Responsável pela classificação</span><input value={draft.responsible} maxLength={150} onChange={(event) => update("responsible", event.target.value)} /></label>
          </div></section>
          <details><summary>Atributos da venda <span>Canal, mercado e características da compra</span></summary><div className="ct-form-grid">
            <SelectField label="Canal da venda" value={draft.channel} options={CHANNELS} onChange={(value) => update("channel", value)} />
            <SelectField label="Mercado geográfico" value={draft.market} options={MARKETS} onChange={(value) => update("market", value)} />
            {ATTRIBUTES.map((attribute) => <SelectField key={attribute.key} label={attribute.label} value={draft[attribute.key]} options={attribute.options} onChange={(value) => update(attribute.key, value)} />)}
          </div></details>
          <details><summary>Fatores de exposição <span>Marque somente vínculos identificados</span></summary>
            <label className="ct-field"><span>Adicionar fator</span><select value="" onChange={(event) => { if (event.target.value) update("factors", [...draft.factors, { code: event.target.value, change: "", evidence: "", direction: "Não identificada", channels: [] }]); }}><option value="">Selecione um fator…</option>{FACTORS.filter((factor) => !draft.factors.some((item) => item.code === factor.code)).map((factor) => <option value={factor.code} key={factor.code}>{factor.label}</option>)}</select></label>
            {draft.factors.map((factor) => <fieldset key={factor.code} className="ct-factor-form"><legend>{FACTORS.find((item) => item.code === factor.code).label}</legend>
              <div className="ct-form-grid">
                <label className="ct-field"><span>Mudança considerada *</span><input value={factor.change} maxLength={240} onChange={(event) => updateFactor(factor.code, "change", event.target.value)} placeholder="Ex.: alta do dólar" /></label>
                <SelectField label="Direção do efeito" value={factor.direction} options={DIRECTIONS} onChange={(value) => updateFactor(factor.code, "direction", value)} />
                <label className="ct-field ct-span-two"><span>Mecanismo e evidência do vínculo *</span><textarea value={factor.evidence} maxLength={1000} onChange={(event) => updateFactor(factor.code, "evidence", event.target.value)} placeholder="Como essa mudança chega ao cedente e qual é a fonte?" /></label>
              </div>
              <div className="ct-checkboxes"><span>Canal do efeito *</span>{EFFECT_CHANNELS.map((channel) => <label key={channel}><input type="checkbox" checked={factor.channels.includes(channel)} onChange={(event) => updateFactor(factor.code, "channels", event.target.checked ? [...factor.channels, channel] : factor.channels.filter((item) => item !== channel))} />{channel}</label>)}</div>
              <button type="button" className="ct-text-button" onClick={() => update("factors", draft.factors.filter((item) => item.code !== factor.code))}>Remover fator</button>
            </fieldset>)}
          </details>
        </div>}
        */}

        {step === "review" && <div className="ct-review">
          <div className="ct-review-identity"><span className="ct-eyebrow">{draft.scope === "cedente" ? "Cedente inteiro" : "Cedente / sacado"}</span><h3>{draft.name}</h3><p>{draft.parcel}</p><strong>{resolvedScope.status === "ready" ? formatCapital(resolvedScope.capitalCents, hideValues) : resolvedScope.message}</strong><small className="ct-review-capital-label">Capital em aberto na carteira consultada</small></div>
          <dl><div><dt>Sacado</dt><dd>{draft.scope === "cedente" ? "Todos os sacados do cedente" : draft.buyer}</dd></div></dl>
          {/* * Campos de contexto da revisão preservados para reativação futura:
          <dl><div><dt>Usuário ou pagador posterior</dt><dd>{draft.downstream || "Não identificado"}</dd></div><div><dt>Qualidade</dt><dd>{draft.quality}</dd></div><div><dt>Fatores identificados</dt><dd>{draft.factors.length ? draft.factors.map((factor) => FACTORS.find((item) => item.code === factor.code).label).join(" · ") : "Nenhum informado; não significa exposição zero"}</dd></div></dl>
          */}
          {(!draft.sector || !draft.purpose || !draft.application) && <p className="ct-notice">Classificação parcial. O cadastro ficará no último ramo informado e poderá ser detalhado depois.</p>}
          <p className="ct-storage-note">Cedente, sacados e capital vêm da carteira. Esta classificação será salva no Supabase para a equipe autorizada.</p>
        </div>}
        {error && <p className="ct-error" role="alert">{error}</p>}
        {saveBlocked && <p className="ct-error" role="alert">{saveBlocked}</p>}
      </div>
      <footer className="ct-dialog-footer"><button type="button" className="ct-button" onClick={goBack}>{visitedSteps.length ? "← Voltar" : "Cancelar"}</button>
        <span>{index + 1} / {steps.length}</span><button className="ct-button ct-primary" type="submit" disabled={Boolean((choices && !draft[step]) || (step === "identity" && (resolvedScope.status !== "ready" || scopeConflict(records, draft))) || (step === "review" && (saveBlocked || resolvedScope.status !== "ready")))}>{step === "review" ? (draft.id ? "Salvar alterações" : "Adicionar à árvore") : "Continuar →"}</button>
      </footer>
    </form>
  </dialog>;
}
