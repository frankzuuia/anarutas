import { assertInstallation, getPool } from "@/core/database";
import { readConfig } from "@/core/config";
import { dispatchRoutePushBatch, readFirebasePushConfig } from "@/core/route-push";

const state = globalThis as typeof globalThis & { routePushWorker?: ReturnType<typeof setInterval> };

export function startRoutePushWorker() {
  if (state.routePushWorker) return;
  if (!process.env.RUTAS_FIREBASE_PROJECT_ID && !process.env.RUTAS_FIREBASE_SERVICE_ACCOUNT_JSON_BASE64) return;
  try {
    readFirebasePushConfig();
  } catch {
    console.error(JSON.stringify({ event: "route_push.config_invalid" }));
    return;
  }
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    void (async () => {
      const pool = getPool();
      await assertInstallation(pool, readConfig().instanceId);
      const claimed = await dispatchRoutePushBatch(pool);
      if (claimed) console.info(JSON.stringify({ event: "route_push.batch", claimed }));
    })().catch(() => console.warn(JSON.stringify({ event: "route_push.worker_unavailable" })))
      .finally(() => { running = false; });
  };
  state.routePushWorker = setInterval(tick, 5000);
  state.routePushWorker.unref();
}
