import { assertInstallation, getPool } from "@/core/database";
import { readConfig } from "@/core/config";
import { archiveWeeklyPlans } from "@/core/plan-archive";

const state = globalThis as typeof globalThis & { planArchiveWorker?: ReturnType<typeof setInterval> };
export function startPlanArchiveWorker() {
  if (state.planArchiveWorker) return;
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    void (async () => {
      const config = readConfig(), pool = getPool();
      await assertInstallation(pool, config.instanceId);
      const result = await archiveWeeklyPlans(pool, config.timezone);
      if (result.archived) console.info(JSON.stringify({ event: "plans.archived", ...result }));
    })().catch(() => console.warn(JSON.stringify({ event: "plans.archive_unavailable" })))
      .finally(() => { running = false; });
  };
  state.planArchiveWorker = setInterval(tick, 60_000);
  state.planArchiveWorker.unref();
  const initial = setTimeout(tick, 10_000);
  initial.unref();
}
