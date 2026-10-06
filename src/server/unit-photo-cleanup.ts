import type { Pool } from "pg";
import { cleanExpiredUnitPhotos } from "../core/unit-photos";
import { unitPhotoCleanupIntervalMs } from "../core/unit-photo-retention";

// No database or filesystem work before the next daily unit-photo sweep.
// A failed sweep remains due; the worker can retry on its next tick.
export class UnitPhotoCleanup {
  private nextCleanup = 0;
  private running = false;

  async runIfDue(pool: Pool, root?: string, now = Date.now()) {
    if (this.running || now < this.nextCleanup) return null;
    this.running = true;
    try {
      const removed = await cleanExpiredUnitPhotos(pool, root);
      this.nextCleanup = now + unitPhotoCleanupIntervalMs;
      return removed;
    } finally {
      this.running = false;
    }
  }
}
