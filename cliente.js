/* === LAFER INVEST - Área do Investidor (cliente.js) ===
 * Ajuste: cria grupos BRUTO/LÍQUIDO com cabeçalho em 2 linhas e
 * adiciona "Valor Atualizado Líquido" (derivado = valor_compra + rendimento_liquido).
 */

(function(){
  'use strict';

  const SUPABASE_URL = "https://sjjxlabvdzihqyadquip.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqanhsYWJ2ZHppaHF5YWRxdWlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ0MDA3NDMsImV4cCI6MjA2OTk3Njc0M30.CvZ50a2dVbv63l8A2ADNNxF9Rab-QMk1rcBv_ZF-UXc"; // público (ok no front)

  // VIEW: usar as colunas existentes; o "valor_atualizado_liquido" será calculado no front.
  const TABLE_NAME = "debentures_portal";
  const COLUMNS = [
    "compra",
    "debenture",
    "serie",
    "pu_inicial",
    "qtde",
    "valor_compra",
    "pu_corrigido",
    "valor_corrigido",
    "rendimento_bruto",
    "rentabilidade_bruta",
    "rendimento_liquido",
    "rentabilidade_liquida",
    "user_id",
    "updated_at"
  ].join(",");

  const LIMIT = 1000;
  let page = 1;
  let totalCount = 0;

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
    return md.full_name || md.nome || md.name || (user?.email?.split("@")[0]) || "Cliente";
  }

  // ===== State/Elements =====
  let authView, appView, authAlert, signupAlert,
      rowsEl, userEmailBadge, pageInfo, totalInfo, nomeEl, dataCorrecaoEl,
      totQtde, totVCompra, totVCorrigido, totVCorrigidoLiq, totRendimentoBruto, totRentabBruta,
      totRendimentoLiq, totRentabLiq,
      loginForm, btnLogout, btnPrev, btnNext;

  // ===== Auth & Routing =====
  async function checkSessionAndRoute(){
    const { data: { user } } = await supabase.auth.getUser();
    if (user){
      if (userEmailBadge) userEmailBadge.textContent = user.email || "";
      if (nomeEl) nomeEl.textContent = getDisplayName(user);
      hide(authView); show(appView);
      page = 1;
      await refreshData();
    } else {
      show(authView); hide(appView);
    }
  }

  // ===== Data Fetch =====
  async function refreshData(){
    const { data: { session} } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return;

    const from = (page - 1) * LIMIT;
    const to   = from + LIMIT - 1;

    // 1) Count
    const { count, error: countError } = await supabase
      .from(TABLE_NAME)
      .select("compra", { count: "exact", head: true })
      .eq("user_id", user.id);

    if (countError){ console.error(countError); }
    totalCount = typeof count === "number" ? count : 0;
    if (totalInfo) totalInfo.textContent = totalCount ? `Total de lançamentos: ${totalCount}` : "";

    // 2) Page data
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select(COLUMNS)
      .eq("user_id", user.id)
      .order("compra", { ascending: true })
      .range(from, to);

    if (error){
      console.error(error);
      showError(authAlert, error.message);
      return;
    }

    renderRows(data || []);
    computeTotals(data || []);

    // Data de correção = maior updated_at recebido
    if (dataCorrecaoEl){
      const latest = (data || []).reduce((max, r) => {
        const dt = r.updated_at ? new Date(r.updated_at) : null;
        return dt && (!max || dt > max) ? dt : max;
      }, null);
      dataCorrecaoEl.textContent = latest ? latest.toLocaleDateString("pt-BR") : "—";
    }

    if (pageInfo) pageInfo.textContent = `Página ${page}`;
  }

  function valorAtualizadoLiquido(r){
    const compra = Number(r.valor_compra || 0);
    const rendL  = Number(r.rendimento_liquido || 0);
    return compra + rendL;
  }

  function renderRows(items){
    if (!rowsEl) return;
    rowsEl.innerHTML = items.map(r => {
      const vAtuLiq = valorAtualizadoLiquido(r);
      return `
      <tr>
        <td class="nowrap">${fmtDate(r.compra)}</td>
        <td>${r.debenture ?? "—"}</td>
        <td class="nowrap">${r.serie ?? "—"}</td>
        <td class="r">${fmtNum(r.pu_inicial)}</td>
        <td class="r">${fmtInt(r.qtde)}</td>
        <td class="r">${fmtBRL(r.valor_compra)}</td>
        <td class="r">${fmtNum(r.pu_corrigido)}</td>

        <!-- Grupo BRUTO -->
        <td class="r group-bruto-cell group-sep">${fmtBRL(r.valor_corrigido)}</td>
        <td class="r group-bruto-cell">${fmtBRL(r.rendimento_bruto)}</td>
        <td class="r group-bruto-cell">${fmtPct(r.rentabilidade_bruta)}</td>

        <!-- Grupo LÍQUIDO -->
        <td class="r group-liquido-cell">${fmtBRL(vAtuLiq)}</td>
        <td class="r group-liquido-cell">${fmtBRL(r.rendimento_liquido)}</td>
        <td class="r group-liquido-cell">${fmtPct(r.rentabilidade_liquida)}</td>
      </tr>`;
    }).join("");
  }

  function computeTotals(items){
    let tQtde = 0, tCompra = 0, tCorr = 0, tCorrLiq = 0, tRendB = 0, tRendL = 0;
    for (const r of items){
      tQtde += Number(r.qtde || 0);
      tCompra += Number(r.valor_compra || 0);
      const corr = Number(r.valor_corrigido || 0);
      const rendB = Number(r.rendimento_bruto || 0);
      const rendL = Number(r.rendimento_liquido || 0);
      tCorr += corr;
      tRendB += rendB;
      tRendL += rendL;
      tCorrLiq += Number(r.valor_compra || 0) + rendL;
    }

    if (totQtde) totQtde.textContent = fmtInt(tQtde);
    if (totVCompra) totVCompra.textContent = fmtBRL(tCompra);
    if (totVCorrigido) totVCorrigido.textContent = fmtBRL(tCorr);
    if (totVCorrigidoLiq) totVCorrigidoLiq.textContent = fmtBRL(tCorrLiq);

    if (totRendimentoBruto) totRendimentoBruto.textContent = fmtBRL(tRendB);
    const rentabBruta = tCompra ? (tRendB / tCompra) * 100 : 0;
    if (totRentabBruta) {
      totRentabBruta.textContent = isFinite(rentabBruta)
        ? rentabBruta.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' %'
        : '—';
    }

    if (totRendimentoLiq) totRendimentoLiq.textContent = fmtBRL(tRendL);
    const rentabLiq = tCompra ? (tRendL / tCompra) * 100 : 0;
    if (totRentabLiq) {
      totRentabLiq.textContent = isFinite(rentabLiq)
        ? rentabLiq.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' %'
        : '—';
    }
  }

  // ===== Bootstrapping =====
  function boot(){
    // Bind elements
    authView = $("auth-view");
    appView  = $("app-view");
    authAlert = $("auth-alert");
    signupAlert = $("signup-alert");
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
    totVCorrigidoLiq = $("tot-vcorrigido-liquido");
    totRendimentoBruto = $("tot-rendimento");
    totRentabBruta = $("tot-rentab");
    totRendimentoLiq = $("tot-rendimento-liquido");
    totRentabLiq = $("tot-rentab-liquida");

    // Forms/Buttons
    loginForm = $("login-form");
    btnLogout = $("btn-logout");
    btnPrev = $("prev");
    btnNext = $("next");

    // Listeners
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
          email,
          password,
          options: { data: { full_name: nome, nome, name: nome } }
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

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot, { once:true });
  } else {
    boot();
  }

})();