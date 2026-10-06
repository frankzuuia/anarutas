"use client";
import { useEffect, useState } from "react";
import type { LiveRoute } from "@/core/live-routes";
import { buildSegmentPlan, type SegmentEstimate, type SegmentSelection } from "@/core/live-segment-policy";
import { api, errors } from "./api";

export function useLiveSegment(route: LiveRoute | undefined, selection: SegmentSelection | null, now: number) {
  const [reload,setReload] = useState(0);
  const [state,setState] = useState<{ key: string; result: SegmentEstimate | null; error: string }>({ key: "", result: null, error: "" });
  let key = "", validation = "";
  if (route && selection?.toStopId) {
    try { key = buildSegmentPlan(route,selection,now).contextKey; }
    catch (error) { validation = errors[(error as Error).message] || "El tramo ya no está disponible."; }
  }
  const request = selection ? JSON.stringify(selection) : "";
  useEffect(() => {
    if (!key || !request) return;
    let disposed = false;
    let pending: AbortController | null = null;
    const read = () => {
      if (disposed || document.hidden || pending) return;
      pending = new AbortController();
      const timer = setTimeout(() => pending?.abort(),30000);
      void api<SegmentEstimate>("/api/live-routes/estimate", "POST", JSON.parse(request), pending.signal)
        .then(result => { if (!disposed && result.contextKey === key) setState({ key,result,error:"" }); })
        .catch((error: Error) => { if (!disposed) setState({ key,result:null,error: error.name === "AbortError" ? "La consulta tardó demasiado. Vuelve a intentar." : error.message }); })
        .finally(() => { clearTimeout(timer); pending = null; });
    };
    const visibility = () => { if (document.hidden) pending?.abort(); else read(); };
    read();
    const interval = setInterval(read,60000);
    document.addEventListener("visibilitychange",visibility);
    window.addEventListener("online",read);
    return () => { disposed = true; pending?.abort(); clearInterval(interval);
      document.removeEventListener("visibilitychange",visibility); window.removeEventListener("online",read); };
  },[key,request,reload]);
  const result = key && state.key === key && state.result && now < Date.parse(state.result.expiresAt) ? state.result : null;
  return { result, error: validation || (state.key === key ? state.error : ""),
    loading: !!key && !result && !(state.key === key && state.error), refresh: () => setReload(n => n+1) };
}
