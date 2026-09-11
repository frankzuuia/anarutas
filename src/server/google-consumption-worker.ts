import { readConfig } from "@/core/config";
import { assertInstallation, getPool } from "@/core/database";
import { AppError } from "@/core/errors";
import { processGoogleConsumptionSync } from "@/core/google-consumption";

const state = globalThis as typeof globalThis & {
  googleConsumptionWorker?: ReturnType<typeof setInterval>;
};

export function startGoogleConsumptionWorker() {
  if (state.googleConsumptionWorker) return;
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    void (async () => {
      const config = readConfig();
      const pool = getPool();
      await assertInstallation(pool, config.instanceId);
      await processGoogleConsumptionSync(pool);
    })()
      .catch((error) =>
        console.warn(
          JSON.stringify({
            event: "google.consumption.worker.unavailable",
            code:
              error instanceof AppError
                ? error.code
                : "GOOGLE_CONSUMPTION_UNAVAILABLE",
          }),
        ),
      )
      .finally(() => {
        running = false;
      });
  };
  state.googleConsumptionWorker = setInterval(tick, 60_000);
  state.googleConsumptionWorker.unref();
  tick();
}
