import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { loadCloudWithLocalImport } from "./cedentesCloud.js";

export default function useCedentesCloud(userId) {
  const [reload, setReload] = useState(0);
  const [state, setState] = useState(null);
  const requestKey = `${userId}/${reload}`;
  useEffect(() => {
    const controller = new AbortController();
    loadCloudWithLocalImport(supabase, window.localStorage, userId, controller.signal).then((result) => {
      if (!controller.signal.aborted) setState({ ...result, status: "ready", requestKey });
    }).catch((error) => {
      if (!controller.signal.aborted) setState({ records: [], status: "error", error: error.message, requestKey });
    });
    return () => controller.abort();
  }, [requestKey, userId]);
  return {
    cloud: state?.requestKey === requestKey ? state : { records: [], status: "loading" },
    refreshCloud: () => setReload((value) => value + 1),
  };
}
