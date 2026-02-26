import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import MicroDashboard from "./MicroDashboard";
import MacroDashboard from "./MacroDashboard";
import UploadData from "./UploadData"; 

export default function App() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [activeTab, setActiveTab] = useState('micro');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [isTablet, setIsTablet] = useState(false);
  const [hideValues, setHideValues] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      if (event === "SIGNED_OUT") setMsg("");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    setMsg("");
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setMsg("Erro no login: " + error.message);
    else setSession(data.session);
  }

  const getTabStyle = (isActive) => ({
    padding: "10px 24px", borderRadius: "8px", border: "0",
    background: isActive ? "#4f46e5" : "#e5e7eb",
    color: isActive ? "#fff" : "#4b5563",
    fontWeight: "700", fontSize: "15px", cursor: "pointer", transition: "all 0.2s",
    boxShadow: isActive ? "0 4px 6px -1px rgba(79, 70, 229, 0.3)" : "none"
  });

  // Recebe estado do sidebar vindo do MicroDashboard
  const handleSidebarToggle = (open, mobile, tablet) => {
    setIsSidebarOpen(open);
    if (mobile !== undefined) setIsMobile(mobile);
    if (tablet !== undefined) setIsTablet(tablet);
  };

  // 3 zonas de layout:
  // Desktop (>= 1024px): translado simétrico, largura preservada
  // Tablet (640–1023px): paddingLeft empurra conteúdo para fora do sidebar
  // Mobile (< 640px): sem deslocamento, sidebar flutua por cima
  const slideStyle = isMobile ? {} : isTablet ? {
    paddingLeft: isSidebarOpen ? "300px" : "0px",
    transition: "padding-left 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
    boxSizing: "border-box"
  } : {
    marginLeft: isSidebarOpen ? "150px" : "0px",
    marginRight: isSidebarOpen ? "-150px" : "0px",
    transition: "margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1), margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
  };

  const isAuthorized = session?.user?.email === 'lafersec@lafersec.com.br';

  return (
    <div style={{ fontFamily: "'Inter', system-ui, Arial, sans-serif", minHeight: "100vh", width: "100%", backgroundColor: "#f3f4f6", padding: "40px 0", boxSizing: "border-box" }}>
      <div style={{ width: "90%", maxWidth: "1400px", margin: "0 auto" }}>

        {!session ? (
          <div>
            <div style={{ marginBottom: 32 }}>
              <h1 style={{ color: "#111827", margin: "0 0 8px 0", fontSize: "32px", fontWeight: "800", letterSpacing: "-0.5px" }}>Dashboard <span style={{ color: "#4f46e5" }}>Lafer Invest</span></h1>
            </div>
            <div style={{ background: "#fff", padding: "40px", borderRadius: "12px", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)", maxWidth: 400, margin: "0 auto", marginTop: "60px" }}>
              <h2 style={{ margin: "0 0 24px 0", color: "#111827", fontSize: "22px", textAlign: "center" }}>Acesso ao Sistema</h2>
              <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <label style={{ display: "block", marginBottom: 6, fontSize: "14px", fontWeight: "500", color: "#374151" }}>E-mail</label>
                  <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="exemplo@empresa.com" type="email" style={{ width: "100%", padding: "12px", borderRadius: "8px", border: "1px solid #d1d5db", boxSizing: "border-box", fontSize: "14px", outline: "none" }} />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: 6, fontSize: "14px", fontWeight: "500", color: "#374151" }}>Senha</label>
                  <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" type="password" style={{ width: "100%", padding: "12px", borderRadius: "8px", border: "1px solid #d1d5db", boxSizing: "border-box", fontSize: "14px", outline: "none" }} />
                </div>
                <button type="submit" style={{ marginTop: "8px", padding: "12px", borderRadius: "8px", border: 0, background: "#4f46e5", color: "#fff", fontWeight: "600", fontSize: "15px", cursor: "pointer" }}>Entrar no Dashboard</button>
              </form>
              {msg && <div style={{ marginTop: 16, padding: "12px", background: "#fef2f2", color: "#991b1b", borderRadius: "8px", fontSize: "14px", border: "1px solid #fecaca" }}>{msg}</div>}
            </div>
          </div>

        ) : !isAuthorized ? (
          <div>
            <div style={{ marginBottom: 32 }}>
              <h1 style={{ color: "#111827", margin: "0 0 8px 0", fontSize: "32px", fontWeight: "800", letterSpacing: "-0.5px" }}>Dashboard <span style={{ color: "#4f46e5" }}>Lafer Invest</span></h1>
            </div>
            <div style={{ background: "#fff", padding: "40px", borderRadius: "12px", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)", maxWidth: 400, margin: "0 auto", marginTop: "60px", textAlign: "center" }}>
              <h2 style={{ margin: "0 0 16px 0", color: "#ef4444", fontSize: "22px" }}>Entrada não autorizada</h2>
              <p style={{ color: "#6b7280", margin: "0 0 8px 0", fontSize: "15px" }}>
                A conta <strong style={{ color: "#111827" }}>{session.user.email}</strong> não possui permissões para visualizar este painel.
              </p>
              <button onClick={() => supabase.auth.signOut()} style={{ marginTop: "24px", padding: "10px 24px", borderRadius: "8px", border: 0, background: "#111827", color: "#fff", fontWeight: "600", fontSize: "15px", cursor: "pointer", transition: "background 0.2s" }} onMouseOver={(e) => e.currentTarget.style.background = "#374151"} onMouseOut={(e) => e.currentTarget.style.background = "#111827"}>
                Sair
              </button>
            </div>
          </div>

        ) : (
          <div>
            {/* Título + header + tabs — mesmo slideStyle do MicroDashboard */}
              <div style={slideStyle}>
              
              {/* Título + botão Sair na mesma linha; em viewports menores quebra para baixo */}
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: 24 }}>
                <h1 style={{ color: "#111827", margin: 0, fontSize: "32px", fontWeight: "800", letterSpacing: "-0.5px" }}>Dashboard <span style={{ color: "#4f46e5" }}>Lafer Invest</span></h1>
                <button onClick={() => supabase.auth.signOut()} style={{ padding: "8px 16px", borderRadius: "6px", border: "1px solid #d1d5db", background: "#fff", color: "#374151", fontSize: "14px", fontWeight: "600", cursor: "pointer", transition: "background 0.2s", whiteSpace: "nowrap" }} onMouseOver={(e) => e.currentTarget.style.background = "#f3f4f6"} onMouseOut={(e) => e.currentTarget.style.background = "#fff"}>
                  Sair do sistema
                </button>
              </div>

              {/* Botões Micro/Macro */}
            <div style={{ display: "flex", gap: "16px", marginBottom: "24px", justifyContent: "center", flexWrap: "wrap" }}>
              <button onClick={() => setActiveTab('micro')} style={getTabStyle(activeTab === 'micro')}>
                Dados Micro (Detalhes de Operações)
              </button>
              <button onClick={() => { setActiveTab('macro'); setIsSidebarOpen(false); }} style={getTabStyle(activeTab === 'macro')}>
                Dados Macro (Visão de Risco)
              </button>
              
              {/* NOVO BOTÃO AQUI */}
              <button onClick={() => { setActiveTab('upload'); setIsSidebarOpen(false); }} style={getTabStyle(activeTab === 'upload')}>
                Atualizar Base de Dados
              </button>
            </div>
            </div>

            {/* MicroDashboard fora do wrapper — translada sozinho */}
            {activeTab === 'micro' && (
              <MicroDashboard session={session} onSidebarToggle={handleSidebarToggle} hideValues={hideValues} setHideValues={setHideValues} />
            )}
            {activeTab === 'macro' && (
              <MacroDashboard session={session} hideValues={hideValues} setHideValues={setHideValues} />
            )}
            {activeTab === 'upload' && (
              <UploadData />
            )}
          </div>
        )}

      </div>
    </div>
  );
}
