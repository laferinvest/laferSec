/* === LAFER INVEST - Área do Investidor (cliente.js) ===
 * Versão robusta: listeners protegidos por checagem de elementos,
 * sem dependência de blocos de cadastro inexistentes.
 * Mantém sessão do Supabase e corrige logout/roteamento.
 */

(function(){
  'use strict';

  /* === Config ===
   * Preencha com seus valores do projeto Supabase (NUNCA exponha a service_role aqui).
   */
  const SUPABASE_URL = "https://sjjxlabvdzihqyadquip.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqanhsYWJ2ZHppaHF5YWRxdWlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ0MDA3NDMsImV4cCI6MjA2OTk3Njc0M30.CvZ50a2dVbv63l8A2ADNNxF9Rab-QMk1rcBv_ZF-UXc"; // público (ok no front)

  // Tabela/view com as colunas pedidas (adeque ao seu schema real)
  const TABLE_NAME = "debentures_portal";
  const COLUMNS = [
    "compra",          // date
    "debenture",       // text
    "serie",           // text
    "pu_inicial",      // numeric
    "qtde",            // numeric
    "valor_compra",    // numeric
    "prazo",           // integer (dias)
    "pu_corrigido",    // numeric
    "valor_corrigido", // numeric
    "rendimento",      // numeric
    "rentabilidade",   // numeric (%)
    "user_id"          // uuid para RLS
  ].join(",");

  // Paginação
  const LIMIT = 1000;
  let page = 1;
  let totalCount = 0;

  // Supabase client
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  // ===== Helpers =====
  function $(id){ return document.getElementById(id); }
  function show(el){ if (el) el.classList.remove("hidden"); }
  function hide(el){ if (el) el.classList.add("hidden"); }

  function fmtBRL(v){
    if (typeof v !== "number") v = Number(v || 0);
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  function fmtInt(v){
    if (v === null || v === undefined || v === '') return '—';
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString("pt-BR", { maximumFractionDigits: 0 }) : '—';
  }
  function fmtNum(v){
    if (v === null || v === undefined || v === '') return '—';
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  }
  function fmtPct(v){
    if (v === null || v === undefined || v === '') return '—';
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " %";
  }
  function fmtDate(d){
    if (!d) return "—";
    const dt = new Date(d);
    if (isNaN(dt)) return "—";
    return dt.toLocaleDateString("pt-BR");
  }
  function showError(el, msg){
    if (!el) return;
    el.textContent = msg || "Ocorreu um erro.";
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 6000);
  }
  function getDisplayName(user){
    const md = user?.user_metadata || {};
    return md.nome || md.name || md.full_name || (user?.email?.split("@")[0]) || "Cliente";
  }

  // ===== State/Elements (serão definidos no boot) =====
  let authView, appView, authAlert, signupAlert,
      rowsEl, userEmailBadge, pageInfo, totalInfo, nomeEl, dataCorrecaoEl,
      totQtde, totVCompra, totVCorrigido, totRendimento, totRentab,
      loginForm, btnLogout, btnPrev, btnNext;

  // ===== Auth & Routing =====
  async function checkSessionAndRoute(){
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user){
      if (userEmailBadge) userEmailBadge.textContent = session.user.email || "";
      if (nomeEl) nomeEl.textContent = getDisplayName(session.user);
      if (dataCorrecaoEl) dataCorrecaoEl.textContent = new Date().toLocaleDateString("pt-BR");
      hide(authView); show(appView);
      page = 1;
      await refreshData();
    } else {
      show(authView); hide(appView);
    }
  }

  // ===== Data Fetch =====
  async function refreshData(){
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return;

    const from = (page - 1) * LIMIT;
    const to   = from + LIMIT - 1;

    // 1) Count
    const countQuery = supabase
      .from(TABLE_NAME)
      .select("compra", { count: "exact", head: true })
      .eq("user_id", user.id);

    const { count, error: countError } = await countQuery;
    if (countError){ console.error(countError); }
    totalCount = typeof count === "number" ? count : 0;
    if (totalInfo) totalInfo.textContent = totalCount ? `Total de lançamentos: ${totalCount}` : "";

    // 2) Page data
    const query = supabase
      .from(TABLE_NAME)
      .select(COLUMNS)
      .eq("user_id", user.id)
      .order("compra", { ascending: true })
      .range(from, to);

    const { data, error } = await query;
    if (error){
      console.error(error);
      showError(authAlert, error.message);
      return;
    }

    renderRows(data || []);
    computeTotals(data || []);
    if (pageInfo) pageInfo.textContent = `Página ${page}`;
  }

  function renderRows(items){
    if (!rowsEl) return;
    rowsEl.innerHTML = items.map(r => `
      <tr>
        <td class="nowrap">${fmtDate(r.compra)}</td>
        <td>${r.debenture ?? "—"}</td>
        <td>${r.serie ?? "—"}</td>
        <td class="r">${fmtNum(r.pu_inicial)}</td>
        <td class="r">${fmtInt(r.qtde)}</td>
        <td class="r">${fmtBRL(r.valor_compra)}</td>
        <td class="r">${fmtInt(r.prazo)}</td>
        <td class="r">${fmtNum(r.pu_corrigido)}</td>
        <td class="r">${fmtBRL(r.valor_corrigido)}</td>
        <td class="r">${fmtBRL(r.rendimento)}</td>
        <td class="r">${fmtPct(r.rentabilidade)}</td>
      </tr>
    `).join("");
  }

  function computeTotals(items){
    let tQtde = 0, tCompra = 0, tCorr = 0, tRend = 0;
    for (const r of items){
      tQtde += Number(r.qtde || 0);
      tCompra += Number(r.valor_compra || 0);
      tCorr += Number(r.valor_corrigido || 0);
      tRend += Number(r.rendimento || 0);
    }
    if (totQtde) totQtde.textContent = fmtInt(tQtde);
    if (totVCompra) totVCompra.textContent = fmtBRL(tCompra);
    if (totVCorrigido) totVCorrigido.textContent = fmtBRL(tCorr);
    if (totRendimento) totRendimento.textContent = fmtBRL(tRend);
    const rentab = tCompra ? (tRend / tCompra) * 100 : 0;
    if (totRentab) {
      totRentab.textContent = isFinite(rentab)
        ? rentab.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' %'
        : '—';
    }
  }

  // ===== Bootstrapping =====
  function boot(){
    // Bind elements
    authView = $("auth-view");
    appView  = $("app-view");
    authAlert = $("auth-alert");
    signupAlert = $("signup-alert"); // pode nem existir na página
    rowsEl = $("rows");
    userEmailBadge = $("user-email");
    pageInfo = $("page-info");
    totalInfo = $("total-info");
    nomeEl = $("debenturista-nome");
    dataCorrecaoEl = $("data-correcao");

    // Totals
    totQtde = $("tot-qtde");
    totVCompra = $("tot-vcompra");
    totVCorrigido = $("tot-vcorrigido");
    totRendimento = $("tot-rendimento");
    totRentab = $("tot-rentab");

    // Forms/Buttons
    loginForm = $("login-form");
    btnLogout = $("btn-logout");
    btnPrev = $("prev");
    btnNext = $("next");

    // Listeners (somente se os elementos existem)
    if (loginForm){
      loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = $("email")?.value.trim();
        const password = $("password")?.value;
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error){ showError(authAlert, error.message); return; }
        await checkSessionAndRoute();
      });
    }

    // Se sua página tiver seção de cadastro no futuro, estes IDs serão detectados e os listeners ativados
    const btnOpenSignup = $("btn-open-signup");
    if (btnOpenSignup){
      btnOpenSignup.addEventListener("click", () => {
        const box = $("signup-box");
        if (box) box.classList.toggle("hidden");
      });
    }
    const signupForm = $("signup-form");
    if (signupForm){
      signupForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = $("signup-email")?.value.trim();
        const password = $("signup-password")?.value;
        const nome = $("signup-name")?.value.trim();
        const { error } = await supabase.auth.signUp({
          email, password, options:{ data:{ nome } }
        });
        if (error){ showError(signupAlert || authAlert, error.message); return; }
        alert("Conta criada. Verifique seu e-mail se necessário e faça login.");
      });
    }

    if (btnLogout){
      btnLogout.addEventListener("click", async () => {
        await supabase.auth.signOut();
        await checkSessionAndRoute();
      });
    }

    if (btnNext){
      btnNext.addEventListener("click", async () => {
        const maxPage = Math.max(1, Math.ceil(totalCount / LIMIT));
        if (page < maxPage){ page++; await refreshData(); }
      });
    }
    if (btnPrev){
      btnPrev.addEventListener("click", async () => {
        if (page > 1){ page--; await refreshData(); }
      });
    }

    // Primeira navegação
    checkSessionAndRoute();
  }

  // Garante que os elementos já existam
  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot, { once:true });
  } else {
    boot();
  }

})();