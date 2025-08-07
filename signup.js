/* === Lafer Invest – cadastro (Supabase v2) === */
(function () {
  'use strict';

  // ————————————————————————————————————————————
  // 1. Supabase client (public anon key is OK on the front-end)
  // ————————————————————————————————————————————
  const SUPABASE_URL  = 'https://sjjxlabvdzihqyadquip.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqanhsYWJ2ZHppaHF5YWRxdWlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ0MDA3NDMsImV4cCI6MjA2OTk3Njc0M30.CvZ50a2dVbv63l8A2ADNNxF9Rab-QMk1rcBv_ZF-UXc';

  const supabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON,
    { auth: { persistSession: false } }          // keep session only in-memory
  );

  // ————————————————————————————————————————————
  // 2. Helpers
  // ————————————————————————————————————————————
  const $        = id => document.getElementById(id);
  const alertBox = $('signup-alert');
  const emailEl  = $('signup-email');
  const nameEl   = $('signup-name');
  const lastEl   = $('signup-lastname');
  const pass1El  = $('signup-password');
  const pass2El  = $('signup-password2');

  const showErr = msg => {
    alertBox.textContent = msg;
    alertBox.classList.remove('d-none');
    setTimeout(() => alertBox.classList.add('d-none'), 6000);
  };
  const getQuery = name => new URLSearchParams(location.search).get(name) || '';

  // ————————————————————————————————————————————
  // 3. Pre-fill e-mail from query-string (?email=)
  // ————————————————————————————————————————————
  emailEl.value = decodeURIComponent(getQuery('email'));
  if (!emailEl.value) showErr('Link inválido: e-mail não encontrado.');

  // ————————————————————————————————————————————
  // 4. Password validator (≥8 chars + ≥1 digit)
  // ————————————————————————————————————————————
  const isValidPwd = p => /^(?=.*\d).{8,}$/.test(p);

  // ————————————————————————————————————————————
  // 5. Create session from URL (invite magic-link)
  // ————————————————————————————————————————————
  async function createSessionFromUrl () {
    // A) OAuth / PKCE code in the query-string
    const { error: exchangeErr } =
      await supabase.auth.exchangeCodeForSession({ storeSession: true });
    if (!exchangeErr) return true;

    // B) Classic invite → #access_token=&refresh_token=
    const hash = location.hash.startsWith('#') ? location.hash.slice(1) : '';
    const params = new URLSearchParams(hash);

    if (params.has('access_token') && params.has('refresh_token')) {
      const { error: sessErr } = await supabase.auth.setSession({
        access_token : params.get('access_token'),
        refresh_token: params.get('refresh_token')
      });
      if (!sessErr) return true;
    }

    showErr(exchangeErr?.message || 'Não foi possível criar a sessão.');
    return false;
  }

  // ————————————————————————————————————————————
  // 6. Handle <form> submit
  // ————————————————————————————————————————————
  $('signup-form').addEventListener('submit', async e => {
    e.preventDefault();

    const first = nameEl.value.trim();
    const last  = lastEl.value.trim();
    const pwd1  = pass1El.value;
    const pwd2  = pass2El.value;

    if (!isValidPwd(pwd1))
      return showErr('A senha precisa ter 8+ caracteres e pelo menos um número.');
    if (pwd1 !== pwd2) return showErr('As senhas não coincidem.');

    // 6.1 Ensure there’s an authenticated session
    const currentSession = (await supabase.auth.getSession()).data.session;
    if (!currentSession && !(await createSessionFromUrl())) return;

    // 6.2 Update password + metadata
    const { error } = await supabase.auth.updateUser({
      password: pwd1,
      data: {
        first_name:  first,
        last_name:   last,
        full_name:   `${first} ${last}`
      }
    });
    if (error) return showErr(error.message);

    alert('Conta criada!');
    location.href = 'cliente.html';          // redirect to login
  });
})();
