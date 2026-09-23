import type { Pool } from "pg";
import { authenticate } from "./auth";
import type { readConfig } from "./config";
import { AppError } from "./errors";
import { subscribePanelChanges } from "./panel-events";

export function panelEventStream(
  pool: Pool,
  config: ReturnType<typeof readConfig>,
  token: string,
  signal: AbortSignal,
) {
  let finish: (close?: boolean) => void = () => {};
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let checking = false;
      let changed = false;
      let unsubscribe: (() => void) | undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let flush: ReturnType<typeof setTimeout> | undefined;
      const emit = (event: string) => {
        if (!closed && (controller.desiredSize ?? 0) <= 0) {
          finish();
          return;
        }
        if (!closed)
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(event === "reset" ? { heartbeatSeconds: config.panelHeartbeatSeconds } : {})}\n\n`,
            ),
          );
      };
      const abort = () => finish();
      finish = (close = true) => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(flush);
        signal.removeEventListener("abort", abort);
        unsubscribe?.();
        if (close) controller.close();
      };
      const check = async () => {
        if (closed || checking) return;
        checking = true;
        try {
          // A visible operational panel is active. Absolute expiry/revocation still apply.
          await authenticate(pool, config, token);
          emit(changed ? "change" : "heartbeat");
          changed = false;
        } catch (error) {
          if (error instanceof AppError && error.status === 401)
            emit("session-expired");
          finish();
        } finally {
          checking = false;
        }
      };
      signal.addEventListener("abort", abort, { once: true });
      try {
        unsubscribe = await subscribePanelChanges(pool, (event) => {
          if (event === "disconnected") {
            finish();
            return;
          }
          changed = true;
          if (!flush && !closed)
            flush = setTimeout(() => {
              flush = undefined;
              void check();
            }, 150);
        });
        if (closed) {
          unsubscribe();
          return;
        }
        if (signal.aborted) {
          finish();
          return;
        }
        await authenticate(pool, config, token);
        emit("reset");
        if (!closed)
          heartbeat = setInterval(
            () => void check(),
            config.panelHeartbeatSeconds * 1000,
          );
      } catch (error) {
        if (error instanceof AppError && error.status === 401)
          emit("session-expired");
        finish();
      }
    },
    cancel() {
      finish(false);
    },
  });
}
