import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { loadCedentesPortfolio } from "./cedentesPortfolio.js";

export default function useCedentesPortfolio(userId, dataRevision) {
  const [reload, setReload] = useState(0);
  const [state, setState] = useState(null);
  const requestKey = `${userId}/${dataRevision}/${reload}`;
  useEffect(() => {
    const controller = new AbortController();
    loadCedentesPortfolio(supabase, controller.signal).then((data) => {
      if (!controller.signal.aborted) setState({ ...data, status: "ready", requestKey });
    }).catch((error) => {
      if (!controller.signal.aborted) setState({ status: "error", error: error.message, cedentes: [], requestKey });
    });
    return () => controller.abort();
  }, [requestKey]);
  return { portfolio: state?.requestKey === requestKey ? state : { status: "loading", cedentes: [] }, refreshPortfolio: () => setReload((value) => value + 1) };
}
