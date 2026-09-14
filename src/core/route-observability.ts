export type RoutingLogLevel = "info" | "warning" | "error";

export type RoutingLogSystem =
  | "Ana Rutas"
  | "Google Route Optimization"
  | "Google Routes API"
  | "PostgreSQL";

export type RoutingLogDetails = Partial<{
  expectedVersion: number;
  orders: number;
  deliveryGroups: number;
  vehicles: number;
  solverTimeoutSeconds: number;
  allocationSource: "Google" | "balance";
  precedenceRules: number;
  skippedDestinations: number;
  priorityConflictOrders: number;
  assignmentChanged: boolean;
  evaluatedCandidates: number;
  stepDurationMs: number;
  segmentsCompleted: number;
  segmentsTotal: number;
  assignedOrders: number;
  skippedOrders: number;
  routes: number;
  lateStops: number;
  lateSeconds: number;
  priorityConflicts: number;
  unusedVehicles: number;
  ordersPerRoute: number[];
  destinationsPerRoute: number[];
  chosenOrdersPerRoute: number[];
  operationalSeconds: number;
  travelSeconds: number;
  makespanSeconds: number;
  maxOrders: number;
  orderImbalance: number;
  maxDestinations: number;
  destinationImbalance: number;
  distanceMeters: number;
  durationSeconds: number;
  errorCode: string;
}>;

export type RoutingLogEntry = {
  message: string;
  event: string;
  level: RoutingLogLevel;
  system: RoutingLogSystem;
  stage: string;
  requestId: string;
  planId: string;
  elapsedMs: number;
  details: RoutingLogDetails;
};

export type RoutingLogSink = (entry: RoutingLogEntry) => void;

const routingDetailKeys = [
  "expectedVersion",
  "orders",
  "deliveryGroups",
  "vehicles",
  "solverTimeoutSeconds",
  "allocationSource",
  "precedenceRules",
  "skippedDestinations",
  "priorityConflictOrders",
  "assignmentChanged",
  "evaluatedCandidates",
  "stepDurationMs",
  "segmentsCompleted",
  "segmentsTotal",
  "assignedOrders",
  "skippedOrders",
  "routes",
  "lateStops",
  "lateSeconds",
  "priorityConflicts",
  "unusedVehicles",
  "ordersPerRoute",
  "destinationsPerRoute",
  "chosenOrdersPerRoute",
  "operationalSeconds",
  "travelSeconds",
  "makespanSeconds",
  "maxOrders",
  "orderImbalance",
  "maxDestinations",
  "destinationImbalance",
  "distanceMeters",
  "durationSeconds",
  "errorCode",
] as const satisfies readonly (keyof RoutingLogDetails)[];

function safeDetails(details: RoutingLogDetails) {
  const safe: RoutingLogDetails = {};
  for (const key of routingDetailKeys)
    if (details[key] !== undefined)
      Object.assign(safe, { [key]: details[key] });
  return safe;
}

function easyPanelSink(entry: RoutingLogEntry) {
  const line = JSON.stringify(entry);
  if (entry.level === "error") console.error(line);
  else if (entry.level === "warning") console.warn(line);
  else console.info(line);
}

export function createRoutingLogger(
  requestId: string,
  planId: string,
  sink: RoutingLogSink = easyPanelSink,
  now: () => number = Date.now,
) {
  const startedAt = now();
  return (
    level: RoutingLogLevel,
    event: string,
    system: RoutingLogSystem,
    stage: string,
    message: string,
    details: RoutingLogDetails = {},
  ) => {
    try {
      sink({
        message,
        event,
        level,
        system,
        stage,
        requestId,
        planId,
        elapsedMs: Math.max(0, now() - startedAt),
        details: safeDetails(details),
      });
    } catch {
      // Observability must never change or interrupt the routing transaction.
    }
  };
}

export type RoutingLogger = ReturnType<typeof createRoutingLogger>;
