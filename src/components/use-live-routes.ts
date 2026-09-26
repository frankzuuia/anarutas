"use client";
import { useEffect, useState } from "react";
import type { LiveRoutesReport } from "@/core/live-routes";
import { trackingPolicy } from "@/core/live-tracking-contract";
import { api } from "./api";

export function useLiveRoutes(revision: number, enabled = true) {
  const [snapshot, setSnapshot] = useState<{ report: LiveRoutesReport; received: number } | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let pending: AbortController | null = null;
    let timeout: ReturnType<typeof setTimeout>;
    const read = () => {
      if (disposed || pending || document.hidden) return;
      pending = new AbortController(); timeout = setTimeout(() => pending?.abort(), 15000);
      void api<LiveRoutesReport>("/api/live-routes", "GET", undefined, pending.signal).then(report => {
        if (!disposed) { const received = performance.now(); setSnapshot({ report, received }); setTick(received); setError(""); }
      }).catch((e: Error) => { if (!disposed) setError(e.name === "AbortError" ? "La consulta tardó demasiado. Reconectando…" : e.message); })
        .finally(() => { clearTimeout(timeout); pending = null; });
    };
    const visibility = () => { if (document.hidden) pending?.abort(); else read(); };
    read();
    const timer = setInterval(read, trackingPolicy.refreshSeconds * 1000);
    const clock = setInterval(() => { if (!document.hidden) setTick(performance.now()); }, 1000);
    document.addEventListener("visibilitychange", visibility); window.addEventListener("online", read);
    return () => { disposed = true; pending?.abort(); clearTimeout(timeout); clearInterval(timer); clearInterval(clock);
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("online", read); };
  }, [enabled, revision, reload]);
  return { report: snapshot?.report ?? null, error, now: snapshot ? Date.parse(snapshot.report.serverTime) + Math.max(0, tick - snapshot.received) : 0,
    refresh: () => setReload(n => n + 1) };
}
