import { getPool, assertInstallation } from "@/core/database";
import { readConfig } from "@/core/config";
import { processRecalculation } from "@/core/route-recalculation";
import { AppError } from "@/core/errors";

const state = globalThis as typeof globalThis & {
  routingWorker?: ReturnType<typeof setInterval>;
};
export function startRoutingWorker() {
  if (state.routingWorker) return;
  let running = false;
  state.routingWorker = setInterval(() => {
    if (running) return;
    running = true;
    void (async () => {
      const config = readConfig(),
        pool = getPool();
      await assertInstallation(pool, config.instanceId);
      await processRecalculation(pool, config.timezone);
    })()
      .catch((error) =>
        console.warn(
          JSON.stringify({
            event: "routing.worker.unavailable",
            code:
              error instanceof AppError
                ? error.code
                : "ROUTING_WORKER_UNAVAILABLE",
          }),
        ),
      )
      .finally(() => {
        running = false;
      });
  }, 1000);
  state.routingWorker.unref();
}
