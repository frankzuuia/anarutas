"use client";

import { useEffect, useSyncExternalStore } from "react";
import type {
  IncidentAlerts,
  IncidentAlertSettings,
} from "@/core/incident-board";
import {
  newIncidentSequences,
  ownsAlarmReservation,
  retainedAlarmActivation,
} from "@/core/incident-board-policy";
import { api } from "./api";

type AlarmState = {
  enabled: boolean;
  playing: boolean;
  message: string;
  settings: IncidentAlertSettings | null;
};
const initial: AlarmState = {
  enabled: false,
  playing: false,
  message: "Activa el sonido en este navegador para recibir la alarma.",
  settings: null,
};
let state = initial;
const subscribers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let context: AudioContext | null = null;
let channel: BroadcastChannel | null = null;
let oscillator: OscillatorNode | null = null;
let polling = false,
  repoll = false;
let scope: string | null = null;
let burst: string[] = [];
let reservation: { key: string; until: string } | null = null;
function readAlerts(query = "") {
  return api<IncidentAlerts>(
    `/api/incidents/alerts${query}`,
    "GET",
    undefined,
    AbortSignal.timeout(15000),
  );
}
function publish(change: Partial<AlarmState>) {
  state = { ...state, ...change };
  subscribers.forEach((fn) => fn());
}
function stopSound() {
  oscillator?.stop();
  oscillator = null;
  burst = [];
  const owned = reservation;
  reservation = null;
  if (owned && navigator.locks) {
    void navigator.locks
      .request(owned.key, () => {
        // Never erase a newer burst started by another tab after this one stopped.
        if (
          ownsAlarmReservation(
            localStorage.getItem(`${owned.key}:until`),
            owned.until,
          )
        ) {
          localStorage.removeItem(`${owned.key}:until`);
          localStorage.removeItem(`${owned.key}:burst`);
        }
      })
      .catch(() =>
        publish({
          message:
            "No se pudo liberar el sonido anterior. Se reintentará al actualizar.",
        }),
      );
  }
  if (state.playing) publish({ playing: false });
}
function sound(seconds: number, key: string) {
  if (!subscribers.size) return;
  if (!context || context.state !== "running")
    throw new Error("El navegador bloqueó el audio. Pulsa Activar sonido.");
  if (oscillator) return;
  const source = context.createOscillator(),
    volume = context.createGain();
  source.type = "sine";
  source.frequency.value = 660;
  const start = context.currentTime;
  for (let offset = 0; offset < seconds; offset += 0.5) {
    volume.gain.setValueAtTime(0.12, start + offset);
    volume.gain.setValueAtTime(0, start + Math.min(offset + 0.2, seconds));
  }
  source.connect(volume);
  volume.connect(context.destination);
  oscillator = source;
  reservation = { key, until: localStorage.getItem(`${key}:until`)! };
  publish({ playing: true });
  source.onended = () => {
    source.disconnect();
    volume.disconnect();
    if (oscillator === source) {
      oscillator = null;
      burst = [];
      reservation = null;
      publish({ playing: false });
    }
  };
  source.start(start);
  source.stop(start + seconds);
}
function storageKey(value: string) {
  return `ana-incidents:${value}`;
}
function cursorRead(key: string, fallback: string) {
  const saved = localStorage.getItem(key);
  return saved && /^(0|[1-9][0-9]{0,18})$/.test(saved) ? saved : fallback;
}
function burstRead(key: string) {
  const value: unknown = JSON.parse(
    localStorage.getItem(`${key}:burst`) ?? "[]",
  );
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && /^(0|[1-9][0-9]{0,18})$/.test(item),
      )
    : [];
}
async function reconcileBurst(key: string) {
  if (!oscillator || !burst.length) return;
  const recorded = burstRead(key),
    remaining: string[] = [];
  for (let i = 0; i < recorded.length; i += 100) {
    const watched = await readAlerts(
      `?watch=${recorded.slice(i, i + 100).join(",")}`,
    );
    remaining.push(...watched.watching);
  }
  burst = remaining;
  localStorage.setItem(`${key}:burst`, JSON.stringify(remaining));
  if (!remaining.length) {
    stopSound();
    localStorage.removeItem(`${key}:until`);
  }
}
async function poll() {
  if (!subscribers.size) return;
  if (polling) {
    repoll = true;
    return;
  }
  polling = true;
  try {
    const baseline = await readAlerts();
    const enabled = retainedAlarmActivation({
      enabled: state.enabled,
      previousScope: scope,
      nextScope: baseline.scope,
      audioState: context?.state ?? null,
    });
    if (state.enabled && !enabled) {
      stopSound();
      publish({ enabled: false, message: initial.message });
    }
    scope = baseline.scope;
    publish({ settings: baseline.settings });
    if (!state.enabled || !subscribers.size) return;
    if (!navigator.locks || !context || context.state !== "running") {
      stopSound();
      publish({
        enabled: false,
        message:
          "Audio no disponible. Pulsa Activar sonido; las incidencias pendientes conservan el recuadro rojo.",
      });
      return;
    }
    await navigator.locks.request(
      storageKey(scope),
      { ifAvailable: true },
      async (lock) => {
        if (!lock || !subscribers.size) return;
        const key = storageKey(baseline.scope);
        let cursor = cursorRead(key, baseline.cursor);
        // Initial activation is a baseline; the durable red state is independent.
        if (localStorage.getItem(key) === null)
          localStorage.setItem(key, cursor);
        const pending: string[] = [];
        let more = true;
        while (more) {
          const result = await readAlerts(`?after=${cursor}`);
          pending.push(...newIncidentSequences(cursor, result.rows));
          cursor = result.cursor;
          more = result.more;
        }
        if (!subscribers.size) return;
        localStorage.setItem(key, cursor);
        if (!pending.length) {
          await reconcileBurst(key);
          return;
        }
        const playingUntil = Number(localStorage.getItem(`${key}:until`) ?? 0);
        // Consume additional arrivals during a bounded burst without extending it.
        if (playingUntil > Date.now()) {
          const joined = [...new Set([...burstRead(key), ...pending])];
          localStorage.setItem(`${key}:burst`, JSON.stringify(joined));
          if (oscillator) burst = joined;
          channel?.postMessage("changed");
          await reconcileBurst(key);
          return;
        }
        localStorage.setItem(
          `${key}:until`,
          String(Date.now() + baseline.settings.seconds * 1000),
        );
        burst = pending;
        localStorage.setItem(`${key}:burst`, JSON.stringify(pending));
        sound(baseline.settings.seconds, key);
        channel?.postMessage("changed");
      },
    );
  } catch (error) {
    publish({
      message:
        error instanceof Error
          ? error.message
          : "No se pudo comprobar la alarma. Se reintentará automáticamente.",
    });
  } finally {
    polling = false;
    if (repoll) {
      repoll = false;
      void poll();
    }
  }
}
function subscribe(listener: () => void) {
  subscribers.add(listener);
  if (!timer) {
    timer = setInterval(() => void poll(), 15000);
    channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel("ana-incident-alerts")
        : null;
    if (channel) channel.onmessage = () => void poll();
    window.addEventListener("online", refreshIncidentAlarm);
    window.addEventListener("focus", refreshIncidentAlarm);
    void poll();
  }
  return () => {
    subscribers.delete(listener);
    if (!subscribers.size) {
      if (timer) clearInterval(timer);
      timer = null;
      channel?.close();
      channel = null;
      window.removeEventListener("online", refreshIncidentAlarm);
      window.removeEventListener("focus", refreshIncidentAlarm);
      stopSound();
      // Retain a successful gesture across panel navigation in this document.
      // A reload/auth navigation creates a new document and starts disabled.
    }
  };
}
export function refreshIncidentAlarm() {
  void poll();
}
export function incidentSeenChanged() {
  channel?.postMessage("changed");
  void poll();
}
export async function activateIncidentAlarm() {
  try {
    if (!navigator.locks)
      throw new Error(
        "Este navegador no permite coordinar el sonido entre pestañas. Usa un navegador actualizado; el aviso rojo sigue activo.",
      );
    context ??= new AudioContext();
    await context.resume();
    if (context.state !== "running")
      throw new Error(
        "El navegador bloqueó el audio. Vuelve a pulsar Activar sonido.",
      );
    const baseline = await readAlerts();
    scope = baseline.scope;
    if (!subscribers.size) return;
    await navigator.locks.request(storageKey(scope), async () => {
      if (localStorage.getItem(storageKey(baseline.scope)) === null)
        localStorage.setItem(storageKey(baseline.scope), baseline.cursor);
    });
    publish({
      enabled: true,
      settings: baseline.settings,
      message:
        "Sonido activo mientras este panel esté abierto y el navegador permita reproducir audio.",
    });
    await navigator.locks.request(
      storageKey(scope),
      { ifAvailable: true },
      async (lock) => {
        if (!lock || !subscribers.size) return;
        const key = `${storageKey(baseline.scope)}:until`,
          until = Number(localStorage.getItem(key) ?? 0);
        if (until <= Date.now()) {
          localStorage.setItem(`${storageKey(baseline.scope)}:burst`, "[]");
          localStorage.setItem(
            key,
            String(Date.now() + baseline.settings.seconds * 1000),
          );
          sound(baseline.settings.seconds, storageKey(baseline.scope));
        }
      },
    );
  } catch (error) {
    publish({ enabled: false, message: (error as Error).message });
  }
}
function noSubscription() {
  return () => {};
}
export function useIncidentAlarm(revision: number, enabled = true) {
  const value = useSyncExternalStore(
    enabled ? subscribe : noSubscription,
    () => (enabled ? state : initial),
    () => initial,
  );
  useEffect(() => {
    if (enabled) refreshIncidentAlarm();
  }, [revision, enabled]);
  return value;
}
