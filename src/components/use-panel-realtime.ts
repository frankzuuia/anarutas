"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { navigateAfterAuth } from "./api";

export function usePanelRealtime(
  refresh: () => Promise<boolean>,
  busy: boolean,
) {
  const [status, setStatus] = useState("Conectando…");
  const pending = useRef(false);
  const running = useRef(false);
  const retryAt = useRef(0);
  const apply = useEffectEvent(async () => {
    if (
      busy ||
      running.current ||
      !pending.current ||
      Date.now() < retryAt.current
    )
      return;
    running.current = true;
    pending.current = false;
    try {
      if (!(await refresh())) {
        pending.current = true;
        retryAt.current = Date.now() + 3000;
      }
    } finally {
      running.current = false;
    }
  });
  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let checkingSession = false;
    let watchdogMs = 45000;
    const changed = () => {
      pending.current = true;
      void apply();
    };
    const received = () => {
      setStatus("En vivo");
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        source?.close();
        source = null;
        connect();
      }, watchdogMs);
    };
    const close = () => {
      source?.close();
      source = null;
      clearTimeout(watchdog);
    };
    const connect = () => {
      if (disposed || source) return;
      if (document.visibilityState === "hidden") {
        setStatus("En pausa");
        return;
      }
      if (!navigator.onLine) {
        setStatus("Sin conexión");
        return;
      }
      setStatus("Conectando…");
      source = new EventSource("/api/events");
      watchdog = setTimeout(() => {
        close();
        connect();
      }, 45000);
      source.addEventListener("reset", (event) => {
        const { heartbeatSeconds } = JSON.parse(
          (event as MessageEvent<string>).data,
        );
        if (Number.isSafeInteger(heartbeatSeconds) && heartbeatSeconds > 0)
          watchdogMs = heartbeatSeconds * 3000;
        received();
        changed();
      });
      source.addEventListener("change", () => {
        received();
        changed();
      });
      source.addEventListener("heartbeat", received);
      source.addEventListener("session-expired", () => {
        close();
        navigateAfterAuth("/login");
      });
      source.onerror = async () => {
        if (disposed) return;
        setStatus("Reconectando…");
        // Distinguish a revoked session from a temporary proxy/network interruption.
        if (checkingSession) return;
        checkingSession = true;
        try {
          const response = await fetch("/api/session", {
            cache: "no-store",
            credentials: "same-origin",
          });
          if (!disposed && response.status === 401) {
            close();
            navigateAfterAuth("/login");
          }
        } catch {
          /* EventSource reconnects; keep existing data visible. */
        } finally {
          checkingSession = false;
        }
      };
    };
    const visibility = () => {
      close();
      connect();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", visibility);
    window.addEventListener("offline", visibility);
    connect();
    // Drain events deferred by a mutation or an in-flight read, without extra requests.
    const drain = setInterval(() => {
      if (document.visibilityState === "visible") void apply();
    }, 250);
    return () => {
      disposed = true;
      close();
      clearInterval(drain);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", visibility);
      window.removeEventListener("offline", visibility);
    };
  }, []);
  return status;
}
