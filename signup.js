/* === Lafer Invest – cadastro === */
(function(){
  'use strict';

  const SUPABASE_URL = "https://sjjxlabvdzihqyadquip.supabase.co";
  const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqanhsYWJ2ZHppaHF5YWRxdWlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ0MDA3NDMsImV4cCI6MjA2OTk3Njc0M30.CvZ50a2dVbv63l8A2ADNNxF9Rab-QMk1rcBv_ZF-UXc"; // público (ok no front)

  const supabase = window.supabase.createClient(
    SUPABASE_URL, SUPABASE_ANON,
    { auth:{persistSession:false} }
  );

  /* --- utilidades --- */
  const $ = (id)=>document.getElementById(id);
  const alertBox = $("signup-alert");
  const emailEl  = $("signup-email");
  const nameEl   = $("signup-name");
  const lastEl   = $("signup-lastname");
  const pass1El  = $("signup-password");
  const pass2El  = $("signup-password2");
  function showErr(msg){
    alertBox.textContent = msg; alertBox.classList.remove("d-none");
    setTimeout(()=>alertBox.classList.add("d-none"),6000);
  }
  function getQuery(name){
    return new URLSearchParams(location.search).get(name)||"";
  }

  /* --- Pré-preenche e-mail vindo da URL (?email=) --- */
  emailEl.value = decodeURIComponent(getQuery("email"));
  if(!emailEl.value){ showErr("Link inválido: e-mail não encontrado."); }

  /* --- Validação de senha --- */
  function validPwd(p){ return /^(?=.*\d).{8,}$/.test(p); }

  /* --- Submit --- */
  $("signup-form").addEventListener("submit", async (e)=>{
    e.preventDefault();

    const email = emailEl.value.trim();
    const first = nameEl.value.trim();
    const last  = lastEl.value.trim();
    const pwd1  = pass1El.value;
    const pwd2  = pass2El.value;

    if(!validPwd(pwd1)){
      return showErr("A senha precisa ter 8+ caracteres e pelo menos um número.");
    }
    if(pwd1!==pwd2){ return showErr("As senhas não coincidem."); }

    /* cria/ativa a conta */
    const { error } = await supabase.auth.signUp({
      email,
      password: pwd1,
      options:{
        data:{
          first_name:first,
          last_name:last,
          full_name:`${first} ${last}`,
          nome:`${first} ${last}`
        }
      }
    });
    if(error){ return showErr(error.message); }

    /* sucesso */
    alert("Conta criada! Verifique seu e-mail para confirmar.");
    location.href="cliente.html";          // redireciona p/ login
  });
})();
