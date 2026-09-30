import { getPool } from "@/core/database";
import { readConfig, readOdooConfig } from "@/core/config";
import { financialSyncConfig } from "@/core/financial-config";
import { financialError, syncFinancialSources } from "@/core/financial-sync";

const state = globalThis as typeof globalThis & {
  financialWorker?: ReturnType<typeof setInterval>;
};
export function startFinancialWorker() {
  if (state.financialWorker) return;
  let running = false;
  const config = financialSyncConfig();
  const tick = () => {
    if (running) return;
    running = true;
    void (async () => {
      const app = readConfig();
      const result = await syncFinancialSources(
        getPool(),
        app.instanceId,
        readOdooConfig(),
        config,
      );
      if (result.status === "synced" || result.status === "failed")
        console.info(JSON.stringify({ event: "financial.sync", ...result }));
    })()
      .catch((error) =>
        console.warn(
          JSON.stringify({
            event: "financial.sync_unavailable",
            code: financialError(error),
          }),
        ),
      )
      .finally(() => {
        running = false;
      });
  };
  state.financialWorker = setInterval(tick, config.pollSeconds * 1000);
  state.financialWorker.unref();
  const initial = setTimeout(tick, 10_000);
  initial.unref();
}
