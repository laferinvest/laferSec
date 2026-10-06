import { useMemo, useRef, useState } from "react";
import { APPLICATIONS, CAPEX_REASONS, CATALOG_VERSION, FACTORS, FAMILIES, PURPOSES, SECTORS, classificationPath, indicatorsFor, labelFor } from "./cedentesCatalog.js";
// * Para reativar o antigo painel de contexto, importar ATTRIBUTES, CHANNELS e MARKETS.
import { NODE_HEIGHT, NODE_WIDTH, buildTree, emptyRecord, flattenTree, layoutTree, normalizeName, validateRecord } from "./cedentesTree.js";
import { availablePortfolioScopes, bindPortfolioScope, formatCapital, resolvePortfolioScope, scopeConflict, summarizeLinkedCapital } from "./cedentesPortfolio.js";
import { deleteCloudRecord, saveCloudRecord } from "./cedentesCloud.js";
import { supabase } from "./supabaseClient.js";
import useCedentesCloud from "./useCedentesCloud.js";
import useCedentesPortfolio from "./useCedentesPortfolio.js";
import CedenteWizard from "./CedenteWizard";
import "./CedentesTreeDashboard.css";

const LEVELS = { root: "Tronco", family: "Família econômica", sector: "Setor de destino", purpose: "Finalidade econômica", application: "Aplicação", record: "Cedente" };
const countCedentes = (records) => new Set(records.map((record) => record.cedenteKey || normalizeName(record.name))).size;
const overduePercentFormatter = new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });

function TreeIcon() {
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 6h6v12h8M11 12h8M11 6h8" stroke="currentColor" strokeWidth="1.7" /><circle cx="4" cy="6" r="2.5" fill="currentColor" /><circle cx="20" cy="6" r="2" fill="currentColor" /><circle cx="20" cy="12" r="2" fill="currentColor" /><circle cx="20" cy="18" r="2" fill="currentColor" /></svg>;
}

function ParcelDetails({ record, hidden, portfolio, onEdit, onDelete, deleting, onAddPath, canAddPath }) {
  const name = (value, placeholder = "Não identificado") => hidden && value ? "Informação oculta" : value || placeholder;
  const balance = resolvePortfolioScope(record, portfolio);
  return <>
    <div className="ct-detail-title"><div><span className="ct-eyebrow">Cedente cadastrado no Supabase</span><h3>{name(record.name)}</h3><p>{name(record.parcel)}</p></div>
      {!hidden && <div className="ct-actions"><button className="ct-button" disabled={deleting} onClick={onEdit}>Editar classificação</button><button className="ct-button ct-delete" disabled={deleting} onClick={onDelete}>{deleting ? "Excluindo…" : "Excluir classificação"}</button>{canAddPath && <button className="ct-button" disabled={deleting} onClick={onAddPath}>Classificar outro sacado</button>}</div>}
    </div>
    <ol className="ct-breadcrumb" aria-label="Caminho completo da parcela">{classificationPath(record).map((part) => <li key={part.code}>{part.label}</li>)}</ol>
    {balance.status === "ready" ? <section className="ct-capital-summary" aria-label="Capital da classificação"><div><span>Capital em aberto · {record.scope === "cedente" ? "todos os sacados" : "sacado selecionado"}</span><strong>{formatCapital(balance.capitalCents, hidden)}</strong><small>{balance.titleCount} títulos em aberto</small></div><dl><div><dt>A vencer</dt><dd>{formatCapital(balance.notDueCents, hidden)}</dd></div><div><dt>Vencido</dt><dd>{formatCapital(balance.overdueCents, hidden)}</dd></div></dl></section> : <p className="ct-notice">{balance.message}</p>}
    <div className="ct-detail-columns">
      <section><h4>Vínculo na carteira</h4><dl className="ct-definition-list"><div><dt>Cedente</dt><dd>{name(record.name)}</dd></div><div><dt>Alcance</dt><dd>{record.scope === "cedente" ? "Todos os sacados do cedente" : "Sacado específico"}</dd></div>{record.scope === "sacado" && <div><dt>Sacado</dt><dd>{name(record.buyer)}</dd></div>}</dl></section>
      <section><h4>Classificação econômica</h4><dl className="ct-definition-list"><div><dt>Família de destino</dt><dd>{labelFor(FAMILIES, record.family)}</dd></div>{record.sector && <div><dt>Setor de destino</dt><dd>{labelFor(SECTORS, record.sector)}</dd></div>}{record.purpose && <div><dt>Finalidade</dt><dd>{labelFor(PURPOSES, record.purpose)}</dd></div>}{record.capex && <div><dt>Motivo do CAPEX</dt><dd>{labelFor(CAPEX_REASONS, record.capex)}</dd></div>}{record.application && <div><dt>Aplicação</dt><dd>{labelFor(APPLICATIONS, record.application)}</dd></div>}</dl>{record.application === "APL-OUT" && <p className="ct-notice">Aplicação para revisão do catálogo: {name(record.applicationDetail)}</p>}</section>
      <section><h4>Indicadores para acompanhar</h4><p className="ct-help">Sugestões ligadas ao caminho escolhido.</p><ul className="ct-indicators">{indicatorsFor(record).map((indicator) => <li key={indicator}>{indicator}</li>)}</ul><p className="ct-help">Sem séries carregadas. Esses indicadores não são uma nota de risco.</p></section>
    </div>
    {/* * Painel de contexto anterior preservado para uso futuro.
    <div className="ct-detail-columns">
      <section><h4>Cadeia comercial e de pagamento</h4><div className="ct-chain"><div><small>Cedente</small><strong>{name(record.name)}</strong></div><span aria-hidden="true">→</span><div><small>Sacado / devedor do título</small><strong>{record.scope === "cedente" ? "Todos os sacados do cedente" : name(record.buyer)}</strong></div><span aria-hidden="true">→</span><div><small>Usuário ou pagador posterior</small><strong>{name(record.downstream)}</strong></div></div>
        <p className="ct-help">Um problema no elo posterior pode afetar o caixa do sacado e chegar ao recebimento do cedente. O vínculo precisa de evidência.</p>
        <dl className="ct-definition-list"><div><dt>Uso imediato</dt><dd>{name(record.immediateUse)}</dd></div><div><dt>Canal</dt><dd>{labelFor(CHANNELS, record.channel)}</dd></div><div><dt>Mercado</dt><dd>{labelFor(MARKETS, record.market)}</dd></div></dl>
        {record.application === "APL-OUT" && <p className="ct-notice">Aplicação para revisão do catálogo: {name(record.applicationDetail)}</p>}
      </section>
      <section><h4>Fatores de exposição</h4>{record.factors.length ? record.factors.map((factor) => <div className="ct-factor-detail" key={factor.code}><strong>{labelFor(FACTORS, factor.code)}</strong><p>{name(factor.change)} <span className="ct-badge">{factor.direction}</span></p><small>{factor.channels.join(" · ")}</small><p className="ct-help">{name(factor.evidence)}</p></div>) : <p className="ct-help">Nenhum fator informado. Isso não significa exposição zero.</p>}</section>
      <section><h4>Indicadores para acompanhar</h4><p className="ct-help">Sugestões de acompanhamento, separadas da classificação.</p><ul className="ct-indicators">{indicatorsFor(record).map((indicator) => <li key={indicator}>{indicator}</li>)}</ul><p className="ct-help">Sem séries carregadas. Variações dos indicadores não se traduzem automaticamente em perdas ou inadimplência.</p><h4>Evidência</h4><dl className="ct-definition-list"><div><dt>Qualidade</dt><dd>{record.quality}</dd></div><div><dt>Fonte</dt><dd>{name(record.source)}</dd></div><div><dt>Verificação</dt><dd>{record.verifiedAt ? record.verifiedAt.split("-").reverse().join("/") : "Não informada"}</dd></div><div><dt>Responsável</dt><dd>{name(record.responsible)}</dd></div></dl></section>
    </div>
    <details className="ct-extra-attributes"><summary>Ver os demais atributos da parcela</summary><dl className="ct-attributes-grid">{ATTRIBUTES.map((attribute) => <div key={attribute.key}><dt>{attribute.label}</dt><dd>{record[attribute.key]}</dd></div>)}</dl></details>
    */}
  </>;
}

export function CedentesTreeView({ cloud, refreshCloud, portfolio, refreshPortfolio, hideValues = false, setHideValues = () => {} }) {
  const [family, setFamily] = useState("all");
  const [showEmpty, setShowEmpty] = useState(false);
  const [showBuyers, setShowBuyers] = useState(false);
  const [detailRecordId, setDetailRecordId] = useState(null);
  const [collapsed, setCollapsed] = useState(new Set());
  const [selectedId, setSelectedId] = useState("portfolio");
  const [zoom, setZoom] = useState(0.85);
  const [query, setQuery] = useState("");
  const [factorCode, setFactorCode] = useState("");
  const [wizard, setWizard] = useState(null);
  const [notice, setNotice] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [actionError, setActionError] = useState("");
  const viewport = useRef(null);
  const details = useRef(null);
  const records = cloud.records;
  const classifiedFamilies = useMemo(() => FAMILIES.filter((item) => records.some((record) => record.family === item.code)), [records]);
  const activeFamily = classifiedFamilies.some((item) => item.code === family) ? family : "all";
  const availableScopes = useMemo(() => availablePortfolioScopes(portfolio, records), [portfolio, records]);
  const hasRecordedFactors = records.some((record) => record.factors.length > 0);
  const tree = useMemo(() => buildTree(records, { family: activeFamily, showEmpty, showBuyers }), [records, activeFamily, showEmpty, showBuyers]);
  const allNodes = useMemo(() => flattenTree(tree), [tree]);
  const layout = useMemo(() => layoutTree(tree, collapsed), [tree, collapsed]);
  const selected = allNodes.find((node) => node.id === selectedId) || allNodes.find((node) => node.kind === "record" && node.recordIds.includes(selectedId.replace(/^record\//, ""))) || tree;
  const selectedRecords = records.filter((record) => selected.recordIds.includes(record.id));
  const detailRecord = selected.kind === "record" ? selectedRecords.find((record) => record.id === detailRecordId) || (selectedRecords.length === 1 ? selectedRecords[0] : null) : null;
  const capitalByNode = useMemo(() => new Map(allNodes.map((node) => [node.id, summarizeLinkedCapital(records.filter((record) => node.recordIds.includes(record.id)), portfolio)])), [allNodes, records, portfolio]);
  const graphCapital = capitalByNode.get(tree.id);
  const selectedNode = layout.nodes.find((node) => node.id === selected.id);
  const selectedPath = new Set([selected.id, ...(selectedNode?.ancestors || [])]);
  const visibleRecords = records.filter((record) => activeFamily === "all" || record.family === activeFamily);
  const matchingIds = useMemo(() => new Set(visibleRecords.filter((record) => {
    const text = [...classificationPath(record).map((part) => part.label), ...record.factors.map((factor) => labelFor(FACTORS, factor.code)), ...(!hideValues ? [record.name, record.parcel, record.buyer, record.downstream] : [])].join(" ");
    return (!query || normalizeName(text).includes(normalizeName(query))) && (!factorCode || record.factors.some((factor) => factor.code === factorCode));
  }).map((record) => record.id)), [visibleRecords, query, factorCode, hideValues]);
  const isFiltering = Boolean(query.trim() || factorCode);
  const factor = FACTORS.find((item) => item.code === factorCode);

  const resetView = () => { setSelectedId("portfolio"); setDetailRecordId(null); setCollapsed(new Set()); viewport.current?.scrollTo({ top: 0, left: 0 }); };
  const toggleNode = (id) => setCollapsed((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const selectNode = (node, revealDetails = false) => {
    setSelectedId(node.id);
    setDetailRecordId(node.kind === "record" ? null : node.id.startsWith("record/") ? node.id.slice(7) : null);
    if (revealDetails) details.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const saveRecord = async (draft) => {
    if (cloud.status !== "ready") return "Aguarde a conexão com o Supabase antes de salvar.";
    const bound = bindPortfolioScope(draft, portfolio);
    if (bound.error) return bound.error;
    const validation = validateRecord(bound.record);
    if (validation) return validation;
    const conflict = scopeConflict(records, bound.record);
    if (conflict) return conflict;
    let record;
    try { record = await saveCloudRecord(supabase, { ...bound.record, fictional: false, catalogVersion: CATALOG_VERSION }); }
    catch (error) { return error.message; }
    refreshCloud();
    setSelectedId(`record/${record.id}`);
    setDetailRecordId(record.id);
    setWizard(null);
    setNotice(`${draft.id ? "Classificação atualizada" : "Cedente adicionado"}. Cadastro salvo no Supabase.`);
    return "";
  };

  const removeRecord = async (record) => {
    if (deletingId || cloud.status !== "ready") return;
    const scope = record.scope === "cedente" ? "todos os sacados" : record.buyer || "este vínculo";
    if (!window.confirm(`Excluir a classificação de ${record.name} (${scope})? Os títulos e o capital da carteira continuam disponíveis.`)) return;
    setDeletingId(record.id);
    setActionError("");
    setNotice("");
    try {
      await deleteCloudRecord(supabase, record);
      resetView();
      refreshCloud();
      setNotice("Classificação excluída. Você pode cadastrar um novo caminho para este vínculo.");
    } catch (error) {
      setActionError(error.message);
    } finally {
      setDeletingId(null);
    }
  };

  return <section className="cedentes-tree" aria-labelledby="ct-title">
    <header className="ct-hero"><div className="ct-hero-copy"><span className="ct-eyebrow"><TreeIcon /> Mapa de exposição econômica</span><h2 id="ct-title">Árvore de cedentes</h2><p>Descubra onde as vendas se conectam — e como uma mudança na economia pode percorrer a sua carteira.</p></div><button className="ct-button ct-primary ct-add" disabled={cloud.status !== "ready"} onClick={() => setWizard(emptyRecord())}><span aria-hidden="true">+</span> Adicionar cedente</button></header>

    <div className="ct-overview"><div><strong>{classifiedFamilies.length}</strong><span>famílias classificadas</span></div><div><strong>{SECTORS.length}</strong><span>setores no catálogo</span></div><div><strong>{countCedentes(records)}</strong><span>cedentes cadastrados</span></div><div><strong>{records.length}</strong><span>classificações</span></div><div className="ct-overview-caption"><span className="ct-small-dot" />Destino da venda como eixo principal<br /><small>Um cedente pode ocupar mais de um caminho.</small></div></div>

    <div className="ct-data-banner"><div><strong>Classificações da equipe · salvas no Supabase</strong><p>Cedentes, sacados e capital vêm da carteira; os caminhos econômicos ficam disponíveis para a equipe autorizada.</p></div></div>
    <div className="ct-portfolio-status"><span role="status">{cloud.status === "loading" ? "Carregando classificações do Supabase…" : cloud.status === "error" ? cloud.error : `${records.length} classificações carregadas do Supabase`}</span><button className="ct-button ct-small" disabled={cloud.status === "loading"} onClick={refreshCloud}>Atualizar árvore</button></div>
    <div className="ct-portfolio-status"><span role="status">{portfolio.status === "loading" ? "Consultando cedentes, sacados e capital…" : portfolio.status === "error" ? portfolio.error : `Carteira consultada às ${new Date(portfolio.loadedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · ${portfolio.cedentes.length} cedentes disponíveis`}</span><button className="ct-button ct-small" disabled={portfolio.status === "loading"} onClick={refreshPortfolio}>Atualizar carteira</button></div>
    {cloud.importError && <p className="ct-error" role="alert">{cloud.importError}</p>}
    {actionError && <p className="ct-error" role="alert">{actionError}</p>}
    {notice && <p className="ct-success" role="status">{notice}<button aria-label="Dispensar aviso" onClick={() => setNotice("")}>×</button></p>}

    <div className="ct-map-panel">
      <div className="ct-map-header"><div><h3>Do destino econômico ao cedente</h3><p>Selecione um nó para entender o caminho. Use + e − nos ramos para abrir ou recolher.</p></div><button className="ct-text-button" onClick={() => { setHideValues(!hideValues); setQuery(""); }}>{hideValues ? "Mostrar nomes" : "Ocultar nomes"}</button></div>
      <div className="ct-toolbar">
        <label className="ct-search"><span className="ct-sr-only">Buscar na árvore</span><svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" /><path d="m12 12 5 5" stroke="currentColor" strokeWidth="1.5" /></svg><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={hideValues ? "Buscar classificação…" : "Buscar cedente, setor ou sacado…"} /></label>
        <label className="ct-toolbar-select"><span>Ramos</span><select aria-label="Filtrar família econômica" value={activeFamily} onChange={(event) => { setFamily(event.target.value); resetView(); }}><option value="all">Todas as famílias</option>{classifiedFamilies.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
        {hasRecordedFactors && <label className="ct-toolbar-select"><span>Fator em comum</span><select aria-label="Destacar fator de exposição" value={factorCode} onChange={(event) => { setFactorCode(event.target.value); setCollapsed(new Set()); }}><option value="">Todos os fatores</option>{FACTORS.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>}
      </div>
      {factor && <div className="ct-factor-banner"><strong>{factor.label}</strong><span>{factor.description} Os caminhos destacados têm esse vínculo registrado.</span><button className="ct-text-button" onClick={() => setFactorCode("")}>Limpar destaque</button></div>}
      <div className="ct-display-controls"><label className="ct-inline-check"><input type="checkbox" checked={showBuyers} onChange={(event) => { setShowBuyers(event.target.checked); setDetailRecordId(null); }} />Mostrar sacado abaixo do cedente</label><span>{showBuyers ? "Cada vínculo aparece com seu sacado." : "Só cedentes: vínculos do mesmo cedente no mesmo ramo são reunidos."}</span></div>
      <div className="ct-map-actions"><div className="ct-actions"><button className="ct-button ct-small" onClick={() => setCollapsed(new Set())}>Expandir tudo</button><button className="ct-button ct-small" onClick={() => { setCollapsed(new Set(allNodes.filter((node) => node.kind === "family").map((node) => node.id))); viewport.current?.scrollTo({ top: 0, left: 0 }); }}>Recolher ramos</button><label className="ct-inline-check"><input type="checkbox" checked={showEmpty} onChange={(event) => setShowEmpty(event.target.checked)} />Mostrar setores sem classificações</label></div>
        <div className="ct-zoom"><button aria-label="Diminuir zoom" disabled={zoom <= 0.7} onClick={() => setZoom((value) => Math.max(0.7, Math.round((value - 0.1) * 100) / 100))}>−</button><output aria-label="Zoom atual">{Math.round(zoom * 100)}%</output><button aria-label="Aumentar zoom" disabled={zoom >= 1.4} onClick={() => setZoom((value) => Math.min(1.4, Math.round((value + 0.1) * 100) / 100))}>+</button><button onClick={() => { setZoom(Math.max(0.7, Math.min(1, (viewport.current.clientWidth - 12) / layout.width))); viewport.current.scrollTo({ top: 0, left: 0 }); }}>Ajustar</button></div>
      </div>
      <div className="ct-canvas" ref={viewport} tabIndex={0} role="region" aria-label="Árvore de exposição econômica. Use as barras de rolagem ou as setas para navegar." style={{ height: activeFamily === "all" ? 640 : 560 }}>
        <div className="ct-canvas-size" style={{ width: layout.width * zoom, height: layout.height * zoom }}><div className="ct-canvas-content" style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}>
          {["CARTEIRA", "FAMÍLIA ECONÔMICA", "SETOR DE DESTINO", "FINALIDADE", "APLICAÇÃO", showBuyers ? "CEDENTE / SACADO" : "CEDENTE"].map((label, index) => layout.nodes.some((node) => node.depth === index) && <span className="ct-column-label" key={label} style={{ left: 26 + index * 246 }}>{label}</span>)}
          <svg className="ct-connections" width={layout.width} height={layout.height} aria-hidden="true">{layout.edges.map(({ from, to }) => {
            const x1 = from.x + NODE_WIDTH; const y1 = from.y + NODE_HEIGHT / 2; const x2 = to.x; const y2 = to.y + NODE_HEIGHT / 2;
            const highlighted = selectedPath.has(from.id) && selectedPath.has(to.id);
            const muted = isFiltering && !to.recordIds.some((id) => matchingIds.has(id));
            const inactive = capitalByNode.get(to.id)?.inactive;
            return <path key={to.id} d={`M${x1},${y1} C${x1 + 24},${y1} ${x2 - 24},${y2} ${x2},${y2}`} fill="none" stroke={inactive ? "#9ca3af" : to.color} strokeWidth={highlighted ? 3 : 1.6} opacity={muted ? 0.12 : highlighted ? 1 : 0.46} />;
          })}</svg>
          {layout.nodes.map((node) => {
            const muted = isFiltering && !node.recordIds.some((id) => matchingIds.has(id)) && !(!factorCode && normalizeName(node.label).includes(normalizeName(query)));
            const selectedHere = selected.id === node.id;
            const label = node.kind === "record" && hideValues ? "Cedente oculto" : node.label;
            const balance = capitalByNode.get(node.id);
            const overduePercentage = hideValues ? "•••%" : balance.capitalCents > 0 ? overduePercentFormatter.format(balance.overdueCents / balance.capitalCents) : "—";
            const overdueGraphPercentage = hideValues ? "•••%" : graphCapital.capitalCents > 0 ? overduePercentFormatter.format(balance.overdueCents / graphCapital.capitalCents) : "—";
            const inactive = node.kind !== "root" && balance.inactive;
            const capitalLabel = balance.inactive ? (balance.linked ? "Sem capital em aberto" : "Sem capital vinculado") : balance.linked ? `${formatCapital(balance.capitalCents, hideValues)}${balance.unavailable ? " · parcial" : ""}` : portfolio.status === "loading" ? "Carregando capital…" : portfolio.status === "error" ? "Capital indisponível" : "Capital não vinculado";
            const buyerLabel = node.kind === "record" ? (node.record.scope === "cedente" ? "Todos os sacados" : hideValues ? "Sacado oculto" : node.record.buyer || "Sacado não identificado") : "";
            return <div key={node.id} className={`ct-node ct-node-${node.kind} ${inactive ? "is-inactive" : ""} ${selectedHere ? "is-selected" : ""} ${muted ? "is-muted" : ""} ${isFiltering && !muted ? "is-match" : ""}`} style={{ left: node.x, top: node.y, width: NODE_WIDTH, height: NODE_HEIGHT, "--branch-color": inactive ? "#9ca3af" : node.color }}>
              <button className="ct-node-main" title={showBuyers && node.kind === "record" ? `${label}\n${buyerLabel}` : label} aria-label={`Ver ${LEVELS[node.kind]}: ${label}${showBuyers && node.kind === "record" ? ` — ${buyerLabel}` : ""}${inactive ? ` — ${capitalLabel.toLowerCase()}` : ""}`} aria-pressed={selectedHere} onClick={() => selectNode(node, node.kind === "record")}>
                <span className="ct-node-type">{node.kind === "record" ? "Cedente" : LEVELS[node.kind]}</span><strong>{label}</strong>
                {node.kind === "record" && showBuyers && <small className="ct-node-buyer">{buyerLabel}</small>}
                {(node.kind !== "record" || (!showBuyers && node.recordIds.length > 1)) && <small>{node.recordIds.length} {node.recordIds.length === 1 ? "classificação" : "classificações"}</small>}
                {node.recordIds.length > 0 && <small className="ct-node-capital">{capitalLabel}</small>}
                {balance.linked > 0 && <small className="ct-node-overdue">Vencido: {formatCapital(balance.overdueCents, hideValues)} (setor: {overduePercentage}, total: {overdueGraphPercentage}){balance.unavailable || graphCapital.unavailable ? " · parcial" : ""}</small>}
              </button>
              {node.children.length > 0 && <button className="ct-node-toggle" aria-label={`${collapsed.has(node.id) ? "Expandir" : "Recolher"} ${label}`} aria-expanded={!collapsed.has(node.id)} onClick={() => toggleNode(node.id)}>{collapsed.has(node.id) ? "+" : "−"}</button>}
            </div>;
          })}
        </div></div>
      </div>
      <div className="ct-map-footer"><span><i className="ct-legend-dot" />Cor identifica a família. Cinza indica classificação sem capital vinculado atualmente.</span><span role="status">{isFiltering ? `${matchingIds.size} ${matchingIds.size === 1 ? "classificação destacada" : "classificações destacadas"}` : `${visibleRecords.length} ${visibleRecords.length === 1 ? "classificação" : "classificações"} nesta visão`} · role para explorar ↔</span></div>
      {isFiltering && !matchingIds.size && <p className="ct-empty-search">Nenhuma classificação corresponde à busca e ao fator nesta família. <button className="ct-text-button" onClick={() => { setQuery(""); setFactorCode(""); setFamily("all"); }}>Limpar filtros</button></p>}
    </div>

    <section className="ct-details" ref={details} aria-label="Detalhes do ramo selecionado">
      {detailRecord ? <ParcelDetails record={detailRecord} hidden={hideValues} portfolio={portfolio} deleting={deletingId === detailRecord.id} onDelete={() => removeRecord(detailRecord)} onEdit={() => setWizard(detailRecord)} canAddPath={availableScopes.some((item) => item.key === detailRecord.cedenteKey && item.availableBuyers.length > 0)} onAddPath={() => setWizard({ ...emptyRecord(), name: detailRecord.name, cedenteKey: detailRecord.cedenteKey || "", scope: "sacado" })} /> : <>
        <div className="ct-detail-title"><div><span className="ct-eyebrow">{LEVELS[selected.kind]}</span><h3>{selected.kind === "root" ? "Uma carteira, várias dependências econômicas" : selected.kind === "record" && hideValues ? "Cedente oculto" : selected.label}</h3><p>{selected.kind === "root" ? "Siga as conexões da esquerda para a direita. Clique em um cedente para ver a classificação e o capital vinculado." : `${countCedentes(selectedRecords)} cedentes em ${selectedRecords.length} classificações neste ramo.`}</p>{capitalByNode.get(selected.id)?.linked > 0 && <p><strong>{formatCapital(capitalByNode.get(selected.id).capitalCents, hideValues)}</strong> de capital em aberto vinculado{capitalByNode.get(selected.id).unavailable ? " · há classificações sem saldo identificado" : ""}</p>}</div><span className="ct-badge">Catálogo · {CATALOG_VERSION.split("-").reverse().join("/")}</span></div>
        {selected.kind === "root" ? <div className="ct-explain-grid"><div><span>01</span><h4>Destino, depois atividade</h4><p>Metal, plástico e frete podem depender da mesma cadeia automotiva, mesmo com atividades diferentes.</p></div><div><span>02</span><h4>O choque percorre a cadeia</h4><p>Menor produção do comprador pode reduzir os pedidos ao fornecedor e pressionar sua receita e seu caixa.</p></div><div><span>03</span><h4>O desconhecido fica visível</h4><p>Classifique até onde houver evidência. Recorrência de demanda não garante margem ou pagamento.</p></div></div> : <>
          {selected.description && <p className="ct-help">{selected.description}</p>}
          {selectedRecords.length ? <div className="ct-parcel-list">{selectedRecords.map((record, index) => <button key={record.id} onClick={() => { setCollapsed(new Set()); selectNode({ id: `record/${record.id}` }); }}><strong>{hideValues ? "Cedente oculto" : record.name}</strong><span>{showBuyers ? (hideValues ? "Sacado oculto" : record.scope === "cedente" ? "Todos os sacados" : record.buyer || "Sacado não identificado") : `Classificação ${index + 1}`}</span><small>Ver resumo →</small></button>)}</div> : <p className="ct-help">Nenhuma classificação foi atribuída a este ramo. Use “Adicionar cedente” para começar.</p>}
          {selected.kind === "family" && <div className="ct-catalog-preview"><h4>Setores disponíveis nesta família</h4>{SECTORS.filter((sector) => sector.family === selected.code).map((sector) => <span key={sector.code} className="ct-badge">{sector.label}</span>)}</div>}
          {selected.kind === "sector" && <div className="ct-catalog-preview"><h4>Opções de finalidade econômica</h4>{PURPOSES.map((purpose) => <span key={purpose.code} className="ct-badge">{purpose.label}</span>)}</div>}
          {selected.kind === "purpose" && <div className="ct-catalog-preview"><h4>Opções de aplicação</h4>{APPLICATIONS.map((application) => <span key={application.code} className="ct-badge">{application.label}</span>)}</div>}
        </>}
      </>}
    </section>
    {cloud.status === "ready" && !records.length && <div className="ct-empty"><TreeIcon /><h3>Sua árvore está pronta para receber o primeiro cedente</h3><p>Escolha um cedente da carteira e classifique todos os sacados dele ou um sacado específico.</p><button className="ct-button ct-primary" onClick={() => setWizard(emptyRecord())}>Adicionar primeiro cedente</button></div>}
    <p className="ct-footnote">Catálogo de trabalho, ainda não validado com a base real. Não é uma classificação oficial do IBGE nem uma nota de risco. As contagens se referem a classificações únicas, sem somar pais e filhos.</p>
    {wizard && <CedenteWizard initialRecord={wizard} records={records} portfolio={portfolio} onRefreshPortfolio={refreshPortfolio} hideValues={hideValues} saveBlocked={cloud.status !== "ready" ? "Aguarde o Supabase carregar antes de salvar." : ""} onClose={() => setWizard(null)} onSave={saveRecord} />}
  </section>;
}

export default function CedentesTreeDashboard({ userId, dataRevision = 0, hideValues, setHideValues }) {
  const { portfolio, refreshPortfolio } = useCedentesPortfolio(userId, dataRevision);
  const { cloud, refreshCloud } = useCedentesCloud(userId);
  return <CedentesTreeView cloud={cloud} refreshCloud={refreshCloud} portfolio={portfolio} refreshPortfolio={refreshPortfolio} hideValues={hideValues} setHideValues={setHideValues} />;
}
