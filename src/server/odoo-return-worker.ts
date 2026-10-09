import { getPool } from "@/core/database";
import { readConfig, readOdooConfig } from "@/core/config";
import { odooReturnConfig } from "@/core/odoo-return-config";
import { activateOdooReturns, syncOdooReturns } from "@/core/odoo-return-store";
import { financialError } from "@/core/financial-sync";

const state = globalThis as typeof globalThis & {
  odooReturnWorker?: ReturnType<typeof setInterval>;
};
export function startOdooReturnWorker() {
  const settings = odooReturnConfig();
  if (!settings.enabled || state.odooReturnWorker) return;
  let running = false,
    activated = false;
  const tick = () => {
    if (running) return;
    running = true;
    void (async () => {
      const app = readConfig(),
        config = readOdooConfig();
      if (!activated) {
        await activateOdooReturns(getPool(), app.instanceId, config);
        activated = true;
      }
      const result = await syncOdooReturns(
        getPool(),
        app.instanceId,
        config,
        settings.pollSeconds,
      );
      if (["prepared", "failed"].includes(result.status))
        console.info(JSON.stringify({ event: "odoo.return.sync", ...result }));
    })()
      .catch((error) =>
        console.warn(
          JSON.stringify({
            event: "odoo.return.unavailable",
            code: financialError(error),
          }),
        ),
      )
      .finally(() => {
        running = false;
      });
  };
  state.odooReturnWorker = setInterval(tick, settings.pollSeconds * 1000);
  state.odooReturnWorker.unref();
  tick();
}
