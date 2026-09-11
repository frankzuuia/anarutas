export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.RUTAS_DATABASE_URL) {
    const { startRoutingWorker } = await import("./server/routing-worker");
    startRoutingWorker();
  }
}
