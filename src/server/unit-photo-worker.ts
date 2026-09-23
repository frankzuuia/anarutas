import { assertInstallation, getPool } from "@/core/database";
import { readConfig } from "@/core/config";
import { cleanExpiredUnitPhotos } from "@/core/unit-photos";

const state = globalThis as typeof globalThis & {
  unitPhotoWorker?: ReturnType<typeof setInterval>;
};

export function startUnitPhotoWorker() {
  if (state.unitPhotoWorker || !process.env.RUTAS_UNIT_PHOTO_DIR) return;
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    void (async () => {
      const config = readConfig();
      const pool = getPool();
      await assertInstallation(pool, config.instanceId);
      const removed = await cleanExpiredUnitPhotos(pool);
      if (removed) console.info(JSON.stringify({ event: "unit_photos.cleaned", removed }));
    })()
      .catch(() => console.warn(JSON.stringify({ event: "unit_photos.cleanup_unavailable" })))
      .finally(() => { running = false; });
  };
  state.unitPhotoWorker = setInterval(tick, 60 * 60 * 1000);
  state.unitPhotoWorker.unref();
  const initial = setTimeout(tick, 10_000);
  initial.unref();
}
