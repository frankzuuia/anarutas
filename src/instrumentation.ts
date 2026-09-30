export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.RUTAS_DATABASE_URL) {
    const { startRoutingWorker } = await import("./server/routing-worker");
    const { startGoogleConsumptionWorker } =
      await import("./server/google-consumption-worker");
    const { startUnitPhotoWorker } = await import("./server/unit-photo-worker");
    const { startRoutePushWorker } = await import("./server/route-push-worker");
    const { startPlanArchiveWorker } = await import("./server/plan-archive-worker");
    const { startFinancialWorker } = await import("./server/financial-worker");
    startRoutingWorker();
    startGoogleConsumptionWorker();
    startUnitPhotoWorker();
    startRoutePushWorker();
    startPlanArchiveWorker();
    startFinancialWorker();
  }
}
