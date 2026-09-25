import type { Pool } from "pg";
import { authenticateMobile } from "./driver-mobile-auth";
import { listDriverPlans } from "./driver-mobile-route";
import { AppError } from "./errors";
import { subscribePanelChanges } from "./panel-events";
import { readOperationPolicy } from "./driver-operation-settings";

export async function driverPublicationFingerprint(
  pool: Pool,
  driverId: string,
) {
  const plans = await listDriverPlans(pool, driverId);
  const policy = await readOperationPolicy(pool);
  return JSON.stringify(
    plans.map((plan) => [
      plan.id,
      plan.vehicle_id,
      Number(plan.publication_revision),
      plan.started_at,
      Number(plan.execution_revision),
      policy.version,
    ]),
  );
}

export function mobileEventStream(
  pool: Pool,
  authorization: string,
  driverId: string,
  signal: AbortSignal,
  heartbeatSeconds: number,
) {
  let finish: (close?: boolean) => void = () => {};
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let checking = false;
      let dirty = false;
      let fingerprint = "";
      let unsubscribe: (() => void) | undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let flush: ReturnType<typeof setTimeout> | undefined;
      const emit = (event: string) => {
        if (closed) return;
        if ((controller.desiredSize ?? 0) <= 0) {
          finish();
          return;
        }
        controller.enqueue(encoder.encode(`event: ${event}\ndata: {}\n\n`));
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
          const principal = await authenticateMobile(pool, authorization);
          if (principal.driver_id !== driverId)
            throw new AppError("MOBILE_UNAUTHENTICATED", 401);
          if (dirty) {
            dirty = false;
            const latest = await driverPublicationFingerprint(pool, driverId);
            if (latest !== fingerprint) {
              fingerprint = latest;
              emit("change");
            }
          } else emit("heartbeat");
        } catch (error) {
          if (error instanceof AppError && error.status === 401)
            emit("session-expired");
          finish();
        } finally {
          checking = false;
          if (dirty && !closed && !flush)
            flush = setTimeout(() => {
              flush = undefined;
              void check();
            }, 150);
        }
      };
      signal.addEventListener("abort", abort, { once: true });
      try {
        unsubscribe = await subscribePanelChanges(pool, (event) => {
          if (event === "disconnected") {
            finish();
            return;
          }
          dirty = true;
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
        const principal = await authenticateMobile(pool, authorization);
        if (principal.driver_id !== driverId)
          throw new AppError("MOBILE_UNAUTHENTICATED", 401);
        fingerprint = await driverPublicationFingerprint(pool, driverId);
        emit("reset");
        if (dirty) void check();
        if (!closed)
          heartbeat = setInterval(() => void check(), heartbeatSeconds * 1000);
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
