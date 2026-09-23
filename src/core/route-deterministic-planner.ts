import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { assertActiveActor } from "./database";
import { AppError } from "./errors";
import { integer, uuid } from "./orders-validation";
import { orderBoard } from "./orders";
import type { OrderBoard } from "./orders-contract";
import { evaluateRoutingCandidate } from "./route-candidate-evaluator";
import { routeFingerprint } from "./route-fingerprint";
import {
  fleetRoutingRequestAllowed,
  maximumFleetRoutingRequests,
} from "./route-fleet-budget";
import {
  buildDirectFleetRequest,
  directFleetDiagnostics,
  directFleetPolicy,
  expandDirectFleetResult,
} from "./route-google-direct";
import {
  parseGoogleOptimizationResponse,
  requestGoogleOptimization,
  type GoogleOptimizationResult,
} from "./route-optimization-google";
import {
  geographicClusterCandidate,
  spatialSequenceCandidate,
} from "./route-geographic-planner";
import {
  acquireOptimizationLease,
  releaseOptimizationLease,
  renewOptimizationLease,
} from "./route-optimization-lease";
import { applyOptimizationResult } from "./route-optimization";
import { createRoadLegReader } from "./route-road";
import {
  createRoutingLogger,
  type RoutingLogger,
  type RoutingLogSink,
  type RoutingLogSystem,
} from "./route-observability";
import { readGoogleRoutingConfig } from "./routing-config";
import { getRoutingSettings } from "./routing-settings";
import type { PublicOptimization } from "./routing-contract";

const recoverableOptimizationErrors = new Set([
  "ROUTING_CONFIG_MISSING",
  "ROUTING_CONFIG_INVALID",
  "ROUTING_GOOGLE_UNAVAILABLE",
  "ROUTING_GOOGLE_QUOTA",
  "ROUTING_GOOGLE_DENIED",
  "ROUTING_RESPONSE_INVALID",
  "ROUTING_CANDIDATE_INVALID",
  "ROUTING_CUSTOMER_GROUP_INVALID",
  "ROUTING_MODEL_INVALID",
  "ROUTING_MODEL_REJECTED",
]);

function asOptimizationResult(
  evaluation: Awaited<ReturnType<typeof evaluateRoutingCandidate>>,
  original: OrderBoard,
): GoogleOptimizationResult {
  const deliveries = original.shipments.filter(
    (s) => s.fulfillmentMode === "delivery" && !s.customerArchived,
  );
  const shipmentIndex = new Map(deliveries.map((s, index) => [s.id, index]));
  const vehicleIndex = new Map(
    original.vehicles.map((v, index) => [v.id, index]),
  );
  return {
    metrics: evaluation.result.metrics,
    skipped: [],
    routes: evaluation.result.routes.map((route) => ({
      vehicleIndex: vehicleIndex.get(route.vehicleId)!,
      departureAt: route.departureAt,
      finishedAt: route.finishedAt,
      encodedPolyline: null,
      trafficMode: route.trafficMode,
      metrics: route.metrics,
      transitions: route.transitions,
      visits: route.stops.map((stop) => ({
        shipmentIndex: shipmentIndex.get(stop.shipmentId)!,
        eta: stop.eta,
        travelDistanceMeters: stop.travelDistanceMeters,
        travelDurationSeconds: stop.travelDurationSeconds,
        waitDurationSeconds: stop.waitDurationSeconds,
        lateSeconds: stop.lateSeconds,
        priorityConflict: stop.priorityConflict,
      })),
    })),
  };
}

export async function planRouteDeterministically(
  pool: Pool,
  actor: string,
  planIdRaw: string,
  input: Record<string, unknown>,
  timezone: string,
  dependencies: {
    googleConfig?: ReturnType<typeof readGoogleRoutingConfig>;
    googleFetch?: typeof fetch;
    googleToken?: () => Promise<string>;
    requestId?: string;
    logSink?: RoutingLogSink;
    readLeg?: ReturnType<typeof createRoadLegReader>;
  } = {},
): Promise<PublicOptimization | null> {
  const planId = uuid(planIdRaw);
  const logger =
    dependencies.requestId || dependencies.logSink
      ? createRoutingLogger(
          dependencies.requestId ?? randomUUID(),
          planId,
          dependencies.logSink,
        )
      : null;
  let currentSystem: RoutingLogSystem = "Ana Rutas";
  let currentStage = "recepción";
  const progress: RoutingLogger = (
    level,
    event,
    system,
    stage,
    message,
    details,
  ) => {
    currentSystem = system;
    currentStage = stage;
    logger?.(level, event, system, stage, message, details);
  };
  progress(
    "info",
    "routing.request.received",
    "Ana Rutas",
    "recepción",
    "Ana Rutas recibió la solicitud. Preparará un único modelo global de Google, sin OpenAI ni optimizaciones adicionales.",
  );
  try {
    const expectedVersion = integer(input.expectedVersion, 1);
    await assertActiveActor(pool, actor);
    const [board, settings] = await Promise.all([
      orderBoard(pool, planId),
      getRoutingSettings(pool),
    ]);
    if (board.plan.version !== expectedVersion)
      throw new AppError("VERSION_CONFLICT", 409);
    const started = await pool.query(
      "SELECT 1 FROM route_plan_publications WHERE plan_id=$1 AND started_at IS NOT NULL LIMIT 1",
      [planId],
    );
    if (started.rowCount)
      throw new AppError("ROUTE_ALREADY_STARTED", 409);
    const { request, groups } = buildDirectFleetRequest(
      board,
      settings,
      timezone,
    );
    const deliveries = board.shipments.filter(
      (s) => s.fulfillmentMode === "delivery" && !s.customerArchived,
    );
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          provider: directFleetPolicy,
          fingerprint: routeFingerprint(board, settings.version),
        }),
      )
      .digest("hex");
    const solverTimeoutSeconds = Number(request.timeout.slice(0, -1));
    const externalTimeout = Math.max(120, solverTimeoutSeconds);
    progress(
      "info",
      "routing.batch.prepared",
      "Ana Rutas",
      "preparación",
      "Modelo preparado con los pedidos y las camionetas actuales. Incluye prioridades, ventanas flexibles, balance y regreso a bodega.",
      {
        expectedVersion,
        orders: deliveries.length,
        deliveryGroups: groups.length,
        vehicles: board.vehicles.length,
        solverTimeoutSeconds,
      },
    );
    const lease = await acquireOptimizationLease(
      pool,
      planId,
      expectedVersion,
      requestHash,
      externalTimeout,
    );
    progress(
      "info",
      "routing.lease.acquired",
      "Ana Rutas",
      "control de concurrencia",
      "Ana Rutas reservó este borrador para impedir dos optimizaciones simultáneas.",
      { expectedVersion },
    );
    try {
      let fleetRoutingRequests = 0;
      let fleetRoutingShipmentUnits = 0;
      let chosenSource: "Google" | "cluster" = "Google";
      let result: GoogleOptimizationResult;
      try {
        const google = dependencies.googleConfig ?? readGoogleRoutingConfig();
        if (!fleetRoutingRequestAllowed(fleetRoutingRequests))
          throw new AppError("ROUTING_GOOGLE_UNAVAILABLE", 503);
        await renewOptimizationLease(pool, planId, lease, externalTimeout);
        fleetRoutingRequests++;
        fleetRoutingShipmentUnits += groups.length;
        progress(
          "info",
          "routing.google.started",
          "Google Route Optimization",
          "optimización global única",
          "Google está resolviendo reparto y secuencia de todas las visitas en una sola solicitud. No se están calculando rutas adicionales.",
          {
            orders: deliveries.length,
            deliveryGroups: groups.length,
            vehicles: board.vehicles.length,
            solverTimeoutSeconds,
            fleetRoutingRequests,
            fleetRoutingRequestLimit: maximumFleetRoutingRequests,
            fleetRoutingShipmentUnits,
          },
        );
        const started = performance.now();
        const raw = await requestGoogleOptimization(
          google.projectId,
          google.credentials,
          request,
          {
            fetch: dependencies.googleFetch,
            token: dependencies.googleToken,
          },
        );
        const response = parseGoogleOptimizationResponse(
          raw,
          groups.length,
          board.vehicles.length,
        );
        result = expandDirectFleetResult(board, groups, response, timezone);
        progress(
          "info",
          "routing.google.completed",
          "Google Route Optimization",
          "respuesta vial completa",
          "Google devolvió el recorrido completo. Ana Rutas conservará sus camionetas, secuencia, tiempos y trazos; no lo reordenará ni volverá a medir con Compute Routes.",
          {
            stepDurationMs: Math.round(performance.now() - started),
            assignedOrders: deliveries.length,
            skippedOrders: 0,
            routes: result.routes.length,
            distanceMeters: result.metrics.travelDistanceMeters,
            durationSeconds: result.metrics.totalDurationSeconds,
            fleetRoutingRequests,
            fleetRoutingRequestLimit: maximumFleetRoutingRequests,
            fleetRoutingShipmentUnits,
          },
        );
      } catch (error) {
        if (
          !(error instanceof AppError) ||
          !recoverableOptimizationErrors.has(error.code)
        )
          throw error;
        chosenSource = "cluster";
        progress(
          "warning",
          "routing.google.unavailable",
          "Ana Rutas",
          "recuperación sin segundo Fleet",
          "Google no devolvió una solución completa utilizable. Se calculará una recuperación geográfica local y se medirán sus calles con Routes; no se repetirá Fleet Routing.",
          {
            errorCode: error.code,
            fleetRoutingRequests,
            fleetRoutingRequestLimit: maximumFleetRoutingRequests,
            fleetRoutingShipmentUnits,
          },
        );
        const candidate = spatialSequenceCandidate(
          board.shipments,
          geographicClusterCandidate(
            board.shipments,
            board.vehicles.map((v) => v.id),
            settings.depotLocation!,
          ),
          settings.depotLocation!,
        );
        let segmentsCompleted = 0;
        const segmentsTotal = candidate.routes.reduce(
          (total, route) =>
            total +
            route.shipmentIds.length +
            Number(route.shipmentIds.length > 0),
          0,
        );
        const evaluation = await evaluateRoutingCandidate(
          board,
          candidate,
          settings,
          timezone,
          async () => {
            await renewOptimizationLease(pool, planId, lease, externalTimeout);
            segmentsCompleted++;
            if (
              segmentsCompleted === 1 ||
              segmentsCompleted === segmentsTotal ||
              segmentsCompleted % Math.max(1, Math.ceil(segmentsTotal / 10)) ===
                0
            )
              progress(
                "info",
                "routing.roads.progress",
                "Google Routes API",
                "medición de recuperación",
                "Google Routes está midiendo los tramos de la recuperación local.",
                { segmentsCompleted, segmentsTotal },
              );
          },
          dependencies.readLeg ?? createRoadLegReader(),
        );
        result = asOptimizationResult(evaluation, board);
      }
      const diagnostics = directFleetDiagnostics(board, result);
      progress(
        diagnostics.priorityConflicts || diagnostics.lateStops
          ? "warning"
          : "info",
        "routing.result.validated",
        "Ana Rutas",
        "validación sin alterar el recorrido",
        "Cobertura completa verificada. El reparto y las excepciones se detallan a continuación; son previsiones, no incidencias reales del chofer.",
        {
          ...diagnostics,
          evaluatedCandidates: 1,
          fleetRoutingRequests,
          fleetRoutingRequestLimit: maximumFleetRoutingRequests,
          fleetRoutingShipmentUnits,
        },
      );
      progress(
        "info",
        "routing.database.started",
        "PostgreSQL",
        "guardado transaccional",
        "PostgreSQL guardará todos los pedidos sin cambiar el orden del recorrido validado.",
        { orders: deliveries.length, routes: result.routes.length },
      );
      const started = performance.now();
      const saved = await applyOptimizationResult(
        pool,
        actor,
        planId,
        expectedVersion,
        settings.version,
        board,
        deliveries,
        requestHash,
        result,
        {
          planner: directFleetPolicy,
          logisticsPolicy: directFleetPolicy,
          evaluatedCandidates: 1,
          candidateSources: [chosenSource],
          chosenSource,
          deliveryGroups: groups.length,
          fleetRoutingRequests,
          fleetRoutingRequestLimit: maximumFleetRoutingRequests,
          fleetRoutingShipmentUnits,
          score: diagnostics,
          providerSequencePreserved: chosenSource === "Google",
        },
      );
      progress(
        "info",
        "routing.completed",
        "PostgreSQL",
        "terminado",
        "Ruta guardada. El conteo final muestra solicitudes Fleet y visitas enviadas. Sin OpenAI ni segunda optimización.",
        {
          stepDurationMs: Math.round(performance.now() - started),
          assignedOrders: saved?.metrics.performedShipmentCount ?? 0,
          skippedOrders: saved?.skipped.length ?? 0,
          routes: saved?.routes.length ?? 0,
          distanceMeters: saved?.metrics.travelDistanceMeters ?? 0,
          durationSeconds: saved?.metrics.totalDurationSeconds ?? 0,
          fleetRoutingRequests,
          fleetRoutingRequestLimit: maximumFleetRoutingRequests,
          fleetRoutingShipmentUnits,
        },
      );
      return saved;
    } finally {
      await releaseOptimizationLease(pool, planId, lease).catch(() => {});
    }
  } catch (error) {
    logger?.(
      "error",
      "routing.failed",
      currentSystem,
      currentStage,
      "El proceso se detuvo. El borrador conserva su último estado válido; no se inventaron tiempos ni se guardó una ruta parcial.",
      {
        errorCode:
          error instanceof AppError ? error.code : "UNEXPECTED_ROUTING_ERROR",
      },
    );
    throw error;
  }
}
