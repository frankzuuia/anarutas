export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.RUTAS_DATABASE_URL) {
    const { startRoutingWorker } = await import("./server/routing-worker");
    const { startGoogleConsumptionWorker } =
      await import("./server/google-consumption-worker");
    const { startUnitPhotoWorker } = await import("./server/unit-photo-worker");
    startRoutingWorker();
    startGoogleConsumptionWorker();
    startUnitPhotoWorker();
  }
}
