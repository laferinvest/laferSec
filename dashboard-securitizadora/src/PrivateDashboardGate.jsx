import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { loadCedenteSettings } from "./cedenteSettings.js";
import { CedenteSettingsContext } from "./cedenteSettingsContext.js";

export default function PrivateDashboardGate({ userId, children }) {
  const [state, setState] = useState(null);
  const [revision, setRevision] = useState(0);
  const requestKey = `${userId}/${revision}`;
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    loadCedenteSettings(supabase, controller.signal).then((settings) => {
      if (!controller.signal.aborted) setState({ requestKey, settings });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ requestKey, error: true });
    });
    return () => controller.abort();
  }, [userId, requestKey]);

  if (!userId || state?.requestKey !== requestKey) return <p role="status">Carregando painel…</p>;
  if (state.error) return <div role="alert">
    <p>Não foi possível carregar as configurações do painel. Tente novamente.</p>
    <button type="button" onClick={() => setRevision((value) => value + 1)}>Tentar novamente</button>
    <button type="button" onClick={() => supabase.auth.signOut()}>Sair</button>
  </div>;
  return <CedenteSettingsContext.Provider value={state.settings}>{children}</CedenteSettingsContext.Provider>;
}
