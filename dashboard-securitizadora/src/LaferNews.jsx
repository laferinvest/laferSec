import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import "./LaferNews.css";

const bucket = supabase.storage.from("lafernews");
const accessLabels = {
  conteudo_consultado: ["Conteúdo consultado", "green"],
  apenas_resumo: ["Apenas resumo", "amber"],
  inacessivel: ["Inacessível", "slate"],
};
const roleLabels = { apoia: "Apoia", contextualiza: "Contexto", contradiz: "Contradiz", corrige: "Corrige" };
const pages = [
  ["summary", "Síntese"],
  ["news", "Triagem"],
  ["memories", "Memórias"],
  ["pending", "Pendências"],
  ["sources", "Fontes"],
];
const impactLabels = ["Setor", "Lafer", "Carteira", "Geral"];

function plain(text) {
  return text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*|`/g, "");
}

function scores(impact) {
  return impact.match(/^(\d|null)\s*\/\s*(\d|null)\s*\/\s*(\d|null)\s*\/\s*(\d|null)/)?.slice(1) ?? [];
}

function Badge({ tone = "slate", children }) {
  return <span className={`ln-badge ln-${tone}`}>{children}</span>;
}

function Heading({ label, title, children }) {
  return <div className="ln-section-head">
    <div><span className="ln-kicker">{label}</span><h3>{title}</h3></div>
    {children}
  </div>;
}

function Disclosure({ title, children }) {
  return <details className="ln-detail">
    <summary>{title}</summary>
    <div className="ln-detail-body">{children}</div>
  </details>;
}

function Source({ source, used }) {
  const [label, tone] = accessLabels[source.access] ?? [source.access, "slate"];
  return <div className="ln-source">
    <div className="ln-source-title">
      <span className="ln-id">{source.id} · {source.publisher}</span>
      <a href={source.url} target="_blank" rel="noreferrer">{source.title} <span aria-hidden="true">↗</span></a>
    </div>
    <div className="ln-source-meta">
      <div className="ln-chips">
        <Badge tone={tone}>{label}</Badge>
        <Badge tone={used ? "indigo" : "slate"}>{used ? "Usada como evidência" : roleLabels[source.role] ?? source.role}</Badge>
      </div>
      {source.group && <small>{source.group}</small>}
    </div>
  </div>;
}

function News({ item, run, open }) {
  const used = new Set(item.claims.flatMap((claim) => claim.evidence.map((entry) => entry.sourceId)));
  const impact = scores(item.impact);
  return <article className="ln-panel">
    <Heading label={item.id} title={item.title} />
    {impact.length > 0 && <dl className="ln-score-grid">
      {impact.map((value, index) => <div key={impactLabels[index]}>
        <dt>{impactLabels[index]}</dt>
        <dd>{value === "null" ? "n/d" : <>{value}<small>/5</small></>}</dd>
      </div>)}
    </dl>}
    <div className="ln-decision">
      <span className="ln-kicker">Decisão do agente</span>
      <p>{plain(item.decision)}</p>
      {!!item.memoryIds.length && <div className="ln-actions">
        {item.memoryIds.map((id) => <button key={id} onClick={() => open("memories", id)}>Abrir memória {id} →</button>)}
      </div>}
    </div>
    <h4>Afirmações e evidências</h4>
    <div className="ln-disclosures">
      {item.claims.map((claim) => <Disclosure key={claim.id} title={<><Badge>{claim.id}</Badge> {claim.classification}</>}>
        <p>{plain(claim.text)}</p>
        {claim.evidence.map((entry) => <div key={entry.id} className="ln-evidence">
          <p><strong>{entry.id}</strong> · {plain(entry.detail)}</p>
          <Source source={run.sources[entry.sourceId]} used />
        </div>)}
      </Disclosure>)}
    </div>
    <div className="ln-disclosures ln-secondary">
      <Disclosure title={`Fontes registradas (${item.sourceIds.length})`}>
        {item.sourceIds.map((id) => <Source key={id} source={run.sources[id]} used={used.has(id)} />)}
      </Disclosure>
      <Disclosure title="Justificativa do impacto">
        <p>{plain(item.impact).replace(/\bnull\b/g, "n/d")}</p>
      </Disclosure>
      {!!item.verification.length && <Disclosure title="Verificações adicionais">
        {item.verification.map((note) => <p key={note}>{plain(note)}</p>)}
      </Disclosure>}
    </div>
  </article>;
}

function Memory({ memory, newsLinks, download }) {
  const { details } = memory;
  return <article className="ln-panel">
    <Heading label={memory.id} title={memory.title}>
      <Badge tone="indigo">{memory.kind === "episodica" ? "Episódica" : "Semântica"} · {details.status}</Badge>
    </Heading>
    {memory.summary && <p className="ln-lead">{plain(memory.summary)}</p>}
    <div className="ln-chips">
      <Badge>Impacto {details.impacto.geral ?? "n/d"}/5</Badge>
      <Badge>Confiança {details.confianca ?? "n/d"}/5</Badge>
      <Badge>Revisão {details.proxima_revisao ?? "n/d"}</Badge>
    </div>
    <h4>Notícias de origem</h4>
    <div className="ln-actions">{newsLinks(memory.newsIds)}</div>
    <div className="ln-disclosures ln-secondary">
      <Disclosure title="Afirmações e evidências da memória">
        {details.afirmacoes.map((claim) => <div key={claim.id} className="ln-evidence">
          <div className="ln-chips">
            <Badge>{claim.id}</Badge><Badge>{claim.classe} · {claim.status_evidencia}</Badge>
            <Badge tone="indigo">Confiança {claim.confianca ?? "n/d"}/5</Badge>
          </div>
          {claim.texto && <p>{claim.texto}</p>}
          {claim.justificativa && <p>{claim.justificativa}</p>}
          {claim.evidencia_ids.map((id) => {
            const evidence = details.evidencias.find((entry) => entry.id === id);
            const source = details.fontes.find((entry) => entry.id_fonte === evidence.fonte_id);
            return <div key={id}>
              <p><strong>{id}</strong> · {evidence.descricao_factual}</p>
              <p className="ln-muted">{evidence.localizacao}</p>
              <Source source={{ id: source.id_fonte, url: source.url, title: source.titulo_fonte,
                publisher: source.publicador, access: source.status_acesso, group: source.grupo_evidencia }} used />
            </div>;
          })}
        </div>)}
      </Disclosure>
      {memory.sections.map(([title, body]) => <Disclosure key={title} title={title}>
        <p className="ln-text">{plain(body)}</p>
      </Disclosure>)}
    </div>
    <div className="ln-actions"><button onClick={() => download(memory.original)}>↓ Baixar memória original</button></div>
  </article>;
}

function Summary({ run, open, newsLinks, download }) {
  return <div className="ln-overview">
    <section className="ln-panel">
      <Heading label="Leitura da rodada" title="Destaques da execução" />
      {run.summary.map((point, index) => {
        const match = point.text.match(/^\*\*(.+?)\*\*\s*(.*)$/s);
        return <article key={point.text} className="ln-highlight">
          <span className="ln-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          <div>
            {match && <h4>{plain(match[1]).replace(/\.$/, "")}</h4>}
            <p>{plain(match?.[2] ?? point.text)}</p>
            <div className="ln-actions">{newsLinks(point.newsIds)}</div>
          </div>
        </article>;
      })}
    </section>
    <aside className="ln-overview-side">
      <section className="ln-panel">
        <Heading label="Em acompanhamento" title="Pendências" />
        {run.pending.length ? <ul className="ln-watch-list">
          {run.pending.map((entry) => <li key={entry.title}>{entry.title.replace(/^PEND-\d+ — /, "")}</li>)}
        </ul> : <p className="ln-muted">Nenhuma pendência nesta execução.</p>}
        {!!run.pending.length && <button className="ln-link-button" onClick={() => open("pending")}>Ver pendências →</button>}
      </section>
      <section className="ln-panel">
        <Heading label="Auditoria" title="Arquivos da execução" />
        <div className="ln-downloads">
          <button onClick={() => download(run.reportOriginal)}><span>Relatório original</span><span aria-hidden="true">↓</span></button>
          <button onClick={() => download(run.logOriginal)}><span>Log da execução</span><span aria-hidden="true">↓</span></button>
        </div>
      </section>
    </aside>
  </div>;
}
export default function LaferNews() {
  const [files, setFiles] = useState(null);
  const [file, setFile] = useState("");
  const [result, setResult] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const [page, setPage] = useState("summary");
  const [itemId, setItemId] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function list() {
      try {
        const manifests = [];
        const limit = 100;
        for (let offset = 0; ; offset += limit) {
          const { data, error } = await bucket.list("", { limit, offset, sortBy: { column: "created_at", order: "desc" } });
          if (error) throw error;
          if (cancelled) return;
          manifests.push(...data.filter((entry) => /^EXEC-\d{8}-[a-f0-9]+-R\d+\.json$/.test(entry.name)));
          if (data.length < limit) break;
        }
        setFiles(manifests);
        setFile(manifests[0]?.name ?? "");
      } catch {
        if (!cancelled) setLoadError(true);
      }
    }
    list();
    return () => { cancelled = true; };
  }, [retry]);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    async function load() {
      try {
        const { data, error } = await bucket.download(file);
        if (error) throw error;
        const run = JSON.parse(await data.text());
        if (run.version !== 1 || `${run.revision}.json` !== file) throw new Error("Manifesto inválido");
        if (!cancelled) setResult({ file, run });
      } catch {
        if (!cancelled) setResult({ file, error: true });
      }
    }
    load();
    return () => { cancelled = true; };
  }, [file, retry]);

  const current = result?.file === file ? result : null;
  const run = current?.run;
  const open = (nextPage, id = "") => {
    setPage(nextPage);
    setItemId(id);
    setDownloadError(false);
  };

  async function download(path) {
    setDownloadError(false);
    const { data, error } = await bucket.download(`${run.revision}/${path}`);
    if (error) {
      setDownloadError(true);
      return;
    }
    const url = URL.createObjectURL(data);
    const link = document.createElement("a");
    link.href = url;
    link.download = path.split("/").at(-1);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }



  const detailHeading = useRef(null);
  useEffect(() => {
    if (itemId) detailHeading.current?.focus();
  }, [itemId]);

  const newsLinks = (ids) => ids.map((id) => {
    const item = run.news.find((entry) => entry.id === id);
    return <button className="ln-link-button" key={id} onClick={() => open("news", id)}>{item.title} <span aria-hidden="true">→</span></button>;
  });

  const metrics = run ? [
    ["news", "Notícias triadas", run.news.length, "indigo"],
    ["sources", "Fontes registradas", Object.keys(run.sources).length, "slate"],
    ["memories", "Memórias", run.memories.length, "green"],
    ["pending", "Pendências", run.pending.length, "amber"],
  ] : [];
  const detailPage = itemId && (page === "news" || page === "memories");
  const usedSources = new Set(run?.news.flatMap((item) =>
    item.claims.flatMap((claim) => claim.evidence.map((entry) => entry.sourceId))
  ));

  return <section className="ln" aria-label="laferNews">
    <header className="ln-hero">
      <div>
        <span className="ln-kicker">Inteligência de mercado</span>
        <h2>laferNews</h2>
        <p>{run?.period ?? "Radar de notícias e trilha de evidências"}</p>
      </div>
      {!!files?.length && <label className="ln-run-picker">Execução
        <select value={file} onChange={(event) => { setFile(event.target.value); open("summary"); }}>
          {files.map((entry) => {
            const [, year, month, day, runId, revision] = entry.name.match(/^EXEC-(\d{4})(\d\d)(\d\d)-([a-f0-9]+)-(R\d+)\.json$/);
            return <option key={entry.name} value={entry.name}>{day}/{month}/{year} · {revision} · {runId.slice(0, 8)}</option>;
          })}
        </select>
      </label>}
    </header>
    {(loadError || current?.error) && <div className="ln-panel ln-feedback" role="alert">
      Não foi possível carregar a execução.{" "}
      <button onClick={() => { setFiles(null); setResult(null); setLoadError(false); setRetry(retry + 1); }}>Tentar novamente</button>
    </div>}
    {!loadError && (!files || (file && !current)) && <p className="ln-panel ln-feedback" role="status">Carregando laferNews…</p>}
    {files?.length === 0 && <p className="ln-panel ln-feedback">Nenhuma execução publicada.</p>}
    {run && <>
      <nav className="ln-nav" aria-label="Seções do laferNews">
        {pages.map(([id, label]) => <button key={id} aria-pressed={page === id} onClick={() => open(id)}>{label}</button>)}
      </nav>
      {downloadError && <p className="ln-panel ln-feedback" role="alert">Não foi possível baixar o original.</p>}
      {page === "summary" && <>
        <div className="ln-metrics">
          {metrics.map(([id, label, value, tone]) => <button className={`ln-metric ln-${tone}`} key={id} onClick={() => open(id)}>
            <span>{label}</span><strong>{value}</strong><span className="ln-metric-arrow" aria-hidden="true">→</span>
          </button>)}
        </div>
        <Summary run={run} open={open} newsLinks={newsLinks} download={download} />
      </>}
      {detailPage && <button className="ln-link-button ln-back" ref={detailHeading} onClick={() => open(page)}>
        ← {page === "news" ? "Todas as notícias" : "Todas as memórias"}
      </button>}
      {page === "news" && (itemId
        ? <News key={itemId} item={run.news.find((item) => item.id === itemId)} run={run} open={open} />
        : <section className="ln-panel">
          <Heading label="Triagem" title="Notícias avaliadas"><Badge>{run.news.length} registros</Badge></Heading>
          <div className="ln-list">{run.news.map((item) => {
            const impact = scores(item.impact)[3];
            return <button className="ln-row" key={item.id} onClick={() => open("news", item.id)}>
              <span><strong>{item.title}</strong><small>{plain(item.decision).split(". ")[0].replace(/\.$/, "")}</small></span>
              {impact && impact !== "null" && <Badge tone={Number(impact) >= 4 ? "indigo" : "slate"}>Impacto {impact}/5</Badge>}
              <span className="ln-row-arrow" aria-hidden="true">→</span>
            </button>;
          })}</div>
        </section>)}
      {page === "memories" && (itemId
        ? <Memory key={itemId} memory={run.memories.find((memory) => memory.id === itemId)} newsLinks={newsLinks} download={download} />
        : <section className="ln-panel">
          <Heading label="Wiki" title="Memórias da execução"><Badge>{run.memories.length} registros</Badge></Heading>
          {run.memories.length === 0 && <p>Nenhuma memória nesta execução.</p>}
          <div className="ln-list">{run.memories.map((memory) => <button className="ln-row" key={memory.id} onClick={() => open("memories", memory.id)}>
            <span><strong>{memory.title}</strong><small>{memory.id} · {memory.details.status}</small></span>
            <Badge tone="indigo">{memory.kind === "episodica" ? "Episódica" : "Semântica"}</Badge>
            <span className="ln-row-arrow" aria-hidden="true">→</span>
          </button>)}</div>
        </section>)}
      {page === "pending" && <section className="ln-panel">
        <Heading label="Acompanhamento" title="Pendências de verificação"><Badge tone="amber">{run.pending.length} registros</Badge></Heading>
        {!run.pending.length && <p>Nenhuma pendência nesta execução.</p>}
        <div className="ln-disclosures">{run.pending.map((entry) => <Disclosure key={entry.title} title={entry.title}>
          <p className="ln-text">{plain(entry.body)}</p>
          <div className="ln-actions">{newsLinks(entry.newsIds)}</div>
        </Disclosure>)}</div>
      </section>}
      {page === "sources" && <section className="ln-panel">
        <Heading label="Rastreabilidade" title="Catálogo de fontes"><Badge>{Object.keys(run.sources).length} registros</Badge></Heading>
        {Object.values(run.sources).map((source) => <Source key={source.id} source={source} used={usedSources.has(source.id)} />)}
      </section>}
    </>}
  </section>;
}
