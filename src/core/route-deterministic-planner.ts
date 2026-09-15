import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { assertActiveActor } from "./database";
import { AppError } from "./errors";
import { integer, uuid } from "./orders-validation";
import { orderBoard } from "./orders";
import type { OrderBoard } from "./orders-contract";
import {
  deterministicPlanningSnapshot,
  evaluateRoutingCandidate,
  googleProposalCandidate,
  parseRoutingCandidate,
} from "./route-candidate-evaluator";
import { routeFingerprint } from "./route-fingerprint";
import {
  fleetRoutingRequestAllowed,
  maximumFleetRoutingRequests,
} from "./route-fleet-budget";
import {
  buildGoogleOptimizationRequest,
  buildGoogleRefinementRequest,
  parseGoogleOptimizationResponse,
  requestGoogleOptimization,
  type GoogleOptimizationRequest,
  type GoogleOptimizationResult,
} from "./route-optimization-google";
import {
  compareLogisticsScores,
  logisticsPolicyVersion,
  type RoutingCandidate,
} from "./route-logistics-policy";
import { allocationSignature } from "./route-logistics-search";
import {
  colocatedAllocationCandidate,
  deadlineSequenceCandidate,
  geographicBalancedCandidate,
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

type Evaluation = Awaited<ReturnType<typeof evaluateRoutingCandidate>>;
type AllocationSource = "Google" | "balance" | "cluster";

function sourceLabel(source: AllocationSource) {
  if (source === "Google") return "Google";
  if (source === "cluster") return "clúster geográfico";
  return "balance geográfico";
}

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

function recoverableOptimizationError(error: unknown): error is AppError {
  return (
    error instanceof AppError && recoverableOptimizationErrors.has(error.code)
  );
}

function asOptimizationResult(
  evaluation: Evaluation,
  original: OrderBoard,
): GoogleOptimizationResult {
  const deliveries = original.shipments.filter(
    (shipment) =>
      shipment.fulfillmentMode === "delivery" && !shipment.customerArchived,
  );
  const shipmentIndex = new Map(
    deliveries.map((shipment, index) => [shipment.id, index]),
  );
  const vehicleIndex = new Map(
    original.vehicles.map((vehicle, index) => [vehicle.id, index]),
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
    "Ana Rutas recibió la solicitud para armar la ruta sin intervención de un LLM.",
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
    const googleRequest = buildGoogleOptimizationRequest(
      board,
      settings,
      timezone,
    );
    const snapshot = deterministicPlanningSnapshot(board, settings, timezone);
    const deliveries = board.shipments.filter(
      (shipment) =>
        shipment.fulfillmentMode === "delivery" && !shipment.customerArchived,
    );
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          provider: "google-deterministic-v5-one-fleet-warm-start",
          policy: logisticsPolicyVersion,
          fingerprint: routeFingerprint(board, settings.version),
        }),
      )
      .digest("hex");
    const solverTimeoutSeconds = Number(googleRequest.timeout.slice(0, -1));
    const externalTimeout = Math.max(120, solverTimeoutSeconds);
    progress(
      "info",
      "routing.batch.prepared",
      "Ana Rutas",
      "preparación",
      `Ana Rutas preparó ${deliveries.length} pedidos de ${snapshot.deliveryGroups.length} destinos para ${board.vehicles.length} camionetas. La decisión será matemática y no llamará OpenAI.`,
      {
        expectedVersion,
        orders: deliveries.length,
        deliveryGroups: snapshot.deliveryGroups.length,
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
      const requestFleetRouting = async (
        request: GoogleOptimizationRequest,
      ) => {
        if (!fleetRoutingRequestAllowed(fleetRoutingRequests)) {
          progress(
            "warning",
            "routing.google.request.skipped",
            "Ana Rutas",
            "protección de costo",
            "Ana Rutas evitó una solicitud Fleet Routing adicional y continuará con la mejor ruta completa ya medida.",
            {
              fleetRoutingRequests,
              fleetRoutingRequestLimit: maximumFleetRoutingRequests,
              fleetRoutingShipmentUnits,
            },
          );
          return null;
        }
        const google = dependencies.googleConfig ?? readGoogleRoutingConfig();
        fleetRoutingRequests++;
        fleetRoutingShipmentUnits += request.model.shipments.length;
        return requestGoogleOptimization(
          google.projectId,
          google.credentials,
          request,
          {
            fetch: dependencies.googleFetch,
            token: dependencies.googleToken,
          },
        );
      };

      const evaluations: { source: AllocationSource; value: Evaluation }[] = [];
      const measured = new Set<string>();
      const readLeg = dependencies.readLeg ?? createRoadLegReader();
      const measure = async (
        source: AllocationSource,
        rawCandidate: RoutingCandidate,
      ) => {
        const candidate = parseRoutingCandidate(rawCandidate, board);
        const signature = JSON.stringify(candidate.routes);
        if (measured.has(signature)) return;
        measured.add(signature);
        const segmentsTotal = candidate.routes.reduce(
          (total, route) =>
            total +
            route.shipmentIds.length +
            (route.shipmentIds.length > 0 ? 1 : 0),
          0,
        );
        let segmentsCompleted = 0;
        const logEvery = Math.max(1, Math.ceil(segmentsTotal / 10));
        progress(
          "info",
          "routing.roads.started",
          "Google Routes API",
          "medición vial",
          `Google Routes comenzó a medir la propuesta de ${sourceLabel(source)} después de ordenar su secuencia con las prioridades obligatorias.`,
          {
            orders: deliveries.length,
            routes: candidate.routes.length,
            segmentsCompleted,
            segmentsTotal,
          },
        );
        const started = performance.now();
        const value = await evaluateRoutingCandidate(
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
              segmentsCompleted % logEvery === 0
            )
              progress(
                "info",
                "routing.roads.progress",
                "Google Routes API",
                "medición vial",
                `Google Routes lleva ${segmentsCompleted} de ${segmentsTotal} tramos medidos.`,
                { segmentsCompleted, segmentsTotal },
              );
          },
          readLeg,
        );
        evaluations.push({ source, value });
        progress(
          "info",
          "routing.candidate.evaluated",
          "Ana Rutas",
          "comparación determinista",
          `Ana Rutas midió la propuesta de ${sourceLabel(source)}: ${value.load.routes.map((route) => route.orders).join("/")} pedidos por camioneta, ${value.lateStops} destinos tarde y ${value.unusedVehicles} camionetas sin uso.`,
          {
            stepDurationMs: Math.round(performance.now() - started),
            evaluatedCandidates: evaluations.length,
            assignedOrders: value.result.metrics.performedShipmentCount,
            routes: value.result.routes.length,
            lateStops: value.lateStops,
            lateSeconds: value.score.lateSeconds,
            priorityConflicts: value.priorityConflicts,
            unusedVehicles: value.unusedVehicles,
            ordersPerRoute: value.load.routes.map((route) => route.orders),
            destinationsPerRoute: value.load.routes.map(
              (route) => route.destinations,
            ),
            maxOrders: value.load.maxOrders,
            orderImbalance: value.load.orderImbalance,
            maxDestinations: value.load.maxDestinations,
            destinationImbalance: value.load.destinationImbalance,
            distanceMeters: value.result.metrics.travelDistanceMeters,
            durationSeconds: value.result.metrics.totalDurationSeconds,
          },
        );
      };

      const allocations: {
        source: AllocationSource;
        candidate: RoutingCandidate;
      }[] = [];
      const seenAllocations = new Set<string>();
      const addAllocation = (
        source: AllocationSource,
        rawCandidate: RoutingCandidate,
      ) => {
        const parsed = parseRoutingCandidate(rawCandidate, board);
        const candidate = parseRoutingCandidate(
          colocatedAllocationCandidate(board.shipments, parsed),
          board,
        );
        if (allocationSignature(parsed) !== allocationSignature(candidate))
          progress(
            "info",
            "routing.colocation.assignment_repaired",
            "Ana Rutas",
            "distribución por punto físico",
            "Ana Rutas reunió en una sola camioneta clientes distintos que comparten exactamente el mismo punto confirmado, sin fusionar sus pedidos ni identidades.",
            { allocationSource: source },
          );
        const signature = allocationSignature(candidate);
        if (seenAllocations.has(signature)) return null;
        seenAllocations.add(signature);
        const allocation = { source, candidate };
        allocations.push(allocation);
        return allocation;
      };
      addAllocation(
        "balance",
        geographicBalancedCandidate(
          board.shipments,
          board.vehicles.map((vehicle) => vehicle.id),
          settings.depotLocation!,
        ),
      );
      addAllocation(
        "cluster",
        geographicClusterCandidate(
          board.shipments,
          board.vehicles.map((vehicle) => vehicle.id),
          settings.depotLocation!,
        ),
      );
      progress(
        "info",
        "routing.cluster.prepared",
        "Ana Rutas",
        "búsqueda geográfica",
        "Ana Rutas terminó un clúster balanceado con intercambios entre zonas hasta convergencia; no usó un número fijo de intentos ni fusionó clientes.",
        { routes: board.vehicles.length },
      );

      progress(
        "info",
        "routing.local.preselection.started",
        "Ana Rutas",
        "preselección sin Fleet Routing",
        "Ana Rutas comparará balance y clúster con prioridad, ventanas y calles medidas para entregar a Google una solución inicial completa dentro de la única solicitud Fleet Routing.",
        {
          routes: board.vehicles.length,
          fleetRoutingRequests,
          fleetRoutingRequestLimit: maximumFleetRoutingRequests,
          fleetRoutingShipmentUnits,
        },
      );
      for (const allocation of allocations) {
        const deadline = deadlineSequenceCandidate(
          board.shipments,
          allocation.candidate,
          settings.depotLocation!,
        );
        await measure(allocation.source, deadline);
        await measure(
          allocation.source,
          spatialSequenceCandidate(
            board.shipments,
            deadline,
            settings.depotLocation!,
          ),
        );
      }
      const preliminaryWinner = [...evaluations].sort((left, right) =>
        compareLogisticsScores(left.value.score, right.value.score),
      )[0];
      if (!preliminaryWinner)
        throw new AppError("ROUTING_RESPONSE_INVALID", 503);

      try {
        const optimizedRequest = buildGoogleRefinementRequest(
          board,
          settings,
          timezone,
          preliminaryWinner.value.candidate,
          preliminaryWinner.value.result,
        );
        await renewOptimizationLease(pool, planId, lease, externalTimeout);
        progress(
          "info",
          "routing.google.started",
          "Google Route Optimization",
          "optimización global única",
          `Google comenzó la única solicitud Fleet Routing con los ${snapshot.deliveryGroups.length} destinos y el mejor reparto local ya medido como solución inicial.`,
          {
            allocationSource: preliminaryWinner.source,
            orders: deliveries.length,
            deliveryGroups: snapshot.deliveryGroups.length,
            vehicles: board.vehicles.length,
            solverTimeoutSeconds,
            fleetRoutingRequests: fleetRoutingRequests + 1,
            fleetRoutingRequestLimit: maximumFleetRoutingRequests,
            fleetRoutingShipmentUnits:
              fleetRoutingShipmentUnits +
              optimizedRequest.model.shipments.length,
          },
        );
        const googleStarted = performance.now();
        const raw = await requestFleetRouting(optimizedRequest);
        if (raw === null) throw new AppError("ROUTING_GOOGLE_UNAVAILABLE", 503);
        const googleResult = parseGoogleOptimizationResponse(
          raw,
          snapshot.deliveryGroups.length,
          board.vehicles.length,
        );
        const googleAssignedOrders = googleResult.routes
          .flatMap((route) => route.visits)
          .reduce(
            (total, visit) =>
              total +
              snapshot.deliveryGroups[visit.shipmentIndex].shipmentIds.length,
            0,
          );
        const googleSkippedOrders = googleResult.skipped.reduce(
          (total, item) =>
            total +
            snapshot.deliveryGroups[item.shipmentIndex].shipmentIds.length,
          0,
        );
        progress(
          googleResult.skipped.length ? "warning" : "info",
          "routing.google.completed",
          "Google Route Optimization",
          "optimización global única",
          googleResult.skipped.length
            ? `Google terminó la única solicitud con ${googleResult.skipped.length} destinos omitidos. Ana Rutas descartará esa propuesta y conservará la ruta local completa.`
            : "Google terminó la única solicitud con todos los destinos. Ana Rutas medirá su propuesta antes de decidir.",
          {
            stepDurationMs: Math.round(performance.now() - googleStarted),
            assignedOrders: googleAssignedOrders,
            skippedOrders: googleSkippedOrders,
            routes: googleResult.routes.length,
            distanceMeters: googleResult.metrics.travelDistanceMeters,
            durationSeconds: googleResult.metrics.totalDurationSeconds,
            fleetRoutingRequests,
            fleetRoutingRequestLimit: maximumFleetRoutingRequests,
            fleetRoutingShipmentUnits,
          },
        );
        if (!googleResult.skipped.length) {
          try {
            const proposed = parseRoutingCandidate(
              googleProposalCandidate(board, googleResult),
              board,
            );
            const googleCandidate = parseRoutingCandidate(
              colocatedAllocationCandidate(board.shipments, proposed),
              board,
            );
            if (
              allocationSignature(proposed) !==
              allocationSignature(googleCandidate)
            )
              progress(
                "info",
                "routing.colocation.assignment_repaired",
                "Ana Rutas",
                "distribución por punto físico",
                "Ana Rutas reunió en una sola camioneta los clientes que comparten exactamente el mismo punto confirmado, sin fusionar sus identidades.",
                { allocationSource: "Google" },
              );
            await measure("Google", googleCandidate);
            const deadline = deadlineSequenceCandidate(
              board.shipments,
              googleCandidate,
              settings.depotLocation!,
            );
            await measure("Google", deadline);
            await measure(
              "Google",
              spatialSequenceCandidate(
                board.shipments,
                deadline,
                settings.depotLocation!,
              ),
            );
          } catch (error) {
            if (!recoverableOptimizationError(error)) throw error;
            progress(
              "warning",
              "routing.google.proposal_rejected",
              "Ana Rutas",
              "validación de cobertura",
              "Ana Rutas descartó la propuesta de Google porque no conservó cobertura o grupos completos; se mantiene la solución local.",
              { errorCode: error.code },
            );
          }
        }
      } catch (error) {
        if (!recoverableOptimizationError(error)) throw error;
        progress(
          "warning",
          "routing.google.unavailable",
          "Ana Rutas",
          "optimización global única",
          "La única solicitud Fleet Routing no pudo completarse. Ana Rutas conservará el mejor reparto local completo ya medido y no hará otra solicitud.",
          {
            errorCode: error.code,
            evaluatedCandidates: evaluations.length,
            fleetRoutingRequests,
            fleetRoutingRequestLimit: maximumFleetRoutingRequests,
            fleetRoutingShipmentUnits,
          },
        );
      }
      const winner = [...evaluations].sort((left, right) =>
        compareLogisticsScores(left.value.score, right.value.score),
      )[0];
      if (!winner) throw new AppError("ROUTING_RESPONSE_INVALID", 503);
      progress(
        "info",
        "routing.logistics.compared",
        "Ana Rutas",
        "comparación determinista",
        `Ana Rutas eligió la propuesta de ${sourceLabel(winner.source)} por prioridad, ventanas, uso de flota, jornada y calles reales; no intervino ningún LLM.`,
        {
          evaluatedCandidates: evaluations.length,
          lateStops: winner.value.lateStops,
          lateSeconds: winner.value.score.lateSeconds,
          chosenOrdersPerRoute: winner.value.load.routes.map(
            (route) => route.orders,
          ),
          operationalSeconds: winner.value.score.operationalSeconds,
          travelSeconds: winner.value.score.travelSeconds,
          makespanSeconds: winner.value.score.makespanSeconds,
          distanceMeters: winner.value.score.distanceMeters,
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
        `PostgreSQL comenzó a guardar atómicamente los ${deliveries.length} pedidos de la ruta elegida.`,
        {
          orders: deliveries.length,
          routes: winner.value.result.routes.length,
          evaluatedCandidates: evaluations.length,
        },
      );
      const databaseStarted = performance.now();
      const saved = await applyOptimizationResult(
        pool,
        actor,
        planId,
        expectedVersion,
        settings.version,
        board,
        deliveries,
        requestHash,
        asOptimizationResult(winner.value, board),
        {
          planner: "google-deterministic-v5-one-fleet-warm-start",
          evaluatedCandidates: evaluations.length,
          candidateSources: evaluations.map((item) => item.source),
          chosenSource: winner.source,
          deliveryGroups: snapshot.deliveryGroups.length,
          fleetRoutingRequests,
          fleetRoutingRequestLimit: maximumFleetRoutingRequests,
          fleetRoutingShipmentUnits,
          logisticsPolicy: logisticsPolicyVersion,
          score: winner.value.score,
        },
      );
      progress(
        "info",
        "routing.completed",
        "PostgreSQL",
        "terminado",
        `Ruta terminada: ${saved?.metrics.performedShipmentCount ?? 0} pedidos quedaron guardados usando ${fleetRoutingRequests} de máximo ${maximumFleetRoutingRequests} solicitudes Fleet Routing, sin OpenAI ni omisiones parciales.`,
        {
          stepDurationMs: Math.round(performance.now() - databaseStarted),
          assignedOrders: saved?.metrics.performedShipmentCount ?? 0,
          skippedOrders: saved?.skipped.length ?? 0,
          routes: saved?.routes.length ?? 0,
          evaluatedCandidates: evaluations.length,
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
      `El proceso para armar la ruta se detuvo durante la etapa: ${currentStage}. El borrador conserva su último estado válido.`,
      {
        errorCode:
          error instanceof AppError ? error.code : "UNEXPECTED_ROUTING_ERROR",
      },
    );
    throw error;
  }
}
