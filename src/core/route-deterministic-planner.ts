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
  buildGoogleOptimizationRequest,
  buildGoogleSequencingRequest,
  parseGoogleOptimizationResponse,
  requestGoogleOptimization,
  type GoogleOptimizationResult,
} from "./route-optimization-google";
import {
  compareLogisticsScores,
  logisticsPolicyVersion,
  priorityConflictIds,
  type RoutingCandidate,
} from "./route-logistics-policy";
import { allocationSignature } from "./route-logistics-search";
import {
  colocatedAllocationCandidate,
  colocatedSequenceCandidate,
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
          provider: "google-deterministic-v2",
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
      const google = dependencies.googleConfig ?? readGoogleRoutingConfig();
      await renewOptimizationLease(pool, planId, lease, externalTimeout);
      progress(
        "info",
        "routing.google.started",
        "Google Route Optimization",
        "optimización vial",
        `Google comenzó a distribuir ${deliveries.length} pedidos entre ${board.vehicles.length} camionetas, considerando tráfico, ventanas y balance blando.`,
        {
          orders: deliveries.length,
          deliveryGroups: snapshot.deliveryGroups.length,
          vehicles: board.vehicles.length,
          solverTimeoutSeconds,
        },
      );
      const googleStarted = performance.now();
      const raw = await requestGoogleOptimization(
        google.projectId,
        google.credentials,
        googleRequest,
        {
          fetch: dependencies.googleFetch,
          token: dependencies.googleToken,
        },
      );
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
        "optimización vial",
        googleResult.skipped.length
          ? `Google terminó con ${googleResult.skipped.length} destinos sin asignar; Ana Rutas no los perderá y medirá una distribución completa.`
          : `Google terminó una propuesta con todos los destinos. Ana Rutas verificará prioridad, ventanas y balance antes de guardarla.`,
        {
          stepDurationMs: Math.round(performance.now() - googleStarted),
          assignedOrders: googleAssignedOrders,
          skippedOrders: googleSkippedOrders,
          routes: googleResult.routes.length,
          distanceMeters: googleResult.metrics.travelDistanceMeters,
          durationSeconds: googleResult.metrics.totalDurationSeconds,
        },
      );

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
        if (seenAllocations.has(signature)) return;
        seenAllocations.add(signature);
        allocations.push({ source, candidate });
      };
      if (!googleResult.skipped.length) {
        try {
          addAllocation("Google", googleProposalCandidate(board, googleResult));
        } catch (error) {
          if (!(
            error instanceof AppError &&
            [
              "ROUTING_CANDIDATE_INVALID",
              "ROUTING_CUSTOMER_GROUP_INVALID",
            ].includes(error.code)
          ))
            throw error;
          progress(
            "warning",
            "routing.google.proposal_rejected",
            "Ana Rutas",
            "validación de cobertura",
            "Ana Rutas descartó la distribución inicial de Google porque no conservó cobertura o grupos completos.",
            { errorCode: error.code },
          );
        }
      }
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

      for (const allocation of allocations) {
        await renewOptimizationLease(pool, planId, lease, externalTimeout);
        const sequencingRequest = buildGoogleSequencingRequest(
          board,
          settings,
          timezone,
          allocation.candidate,
        );
        progress(
          "info",
          "routing.google.sequence.started",
          "Google Route Optimization",
          "secuencia vial con prioridad",
          `Google comenzó a ordenar por calles reales la distribución de ${sourceLabel(allocation.source)}; cada destino quedó fijo en su camioneta y las prioridades quedaron como precedencias por ruta.`,
          {
            allocationSource: allocation.source,
            deliveryGroups: snapshot.deliveryGroups.length,
            precedenceRules:
              sequencingRequest.model.precedenceRules?.length ?? 0,
            routes: allocation.candidate.routes.length,
          },
        );
        const sequencingStarted = performance.now();
        const rawSequence = await requestGoogleOptimization(
          google.projectId,
          google.credentials,
          sequencingRequest,
          {
            fetch: dependencies.googleFetch,
            token: dependencies.googleToken,
          },
        );
        const sequencedResult = parseGoogleOptimizationResponse(
          rawSequence,
          snapshot.deliveryGroups.length,
          board.vehicles.length,
        );
        if (sequencedResult.skipped.length) {
          progress(
            "warning",
            "routing.google.sequence.rejected",
            "Ana Rutas",
            "validación de secuencia",
            "Ana Rutas descartó una secuencia porque Google omitió destinos; no se guardó ningún resultado parcial.",
            {
              allocationSource: allocation.source,
              skippedDestinations: sequencedResult.skipped.length,
            },
          );
          continue;
        }
        const sequencedCandidate = parseRoutingCandidate(
          googleProposalCandidate(board, sequencedResult),
          board,
        );
        const assignmentChanged =
          allocationSignature(sequencedCandidate) !==
          allocationSignature(allocation.candidate);
        const conflicts = priorityConflictIds(
          board.shipments,
          sequencedCandidate,
        );
        if (assignmentChanged || conflicts.size) {
          progress(
            "warning",
            "routing.google.sequence.rejected",
            "Ana Rutas",
            "validación de secuencia",
            "Ana Rutas descartó una secuencia porque no respetó la camioneta fija o la precedencia de prioridades.",
            {
              allocationSource: allocation.source,
              assignmentChanged,
              priorityConflictOrders: conflicts.size,
            },
          );
          continue;
        }
        progress(
          "info",
          "routing.google.sequence.completed",
          "Google Route Optimization",
          "secuencia vial con prioridad",
          `Google terminó la secuencia vial de la distribución de ${sourceLabel(allocation.source)} sin omitir destinos ni alterar camionetas.`,
          {
            allocationSource: allocation.source,
            stepDurationMs: Math.round(performance.now() - sequencingStarted),
            priorityConflictOrders: 0,
            skippedDestinations: 0,
          },
        );
        const compacted = colocatedSequenceCandidate(
          board.shipments,
          sequencedCandidate,
        );
        if (
          JSON.stringify(compacted.routes) !==
          JSON.stringify(sequencedCandidate.routes)
        )
          progress(
            "info",
            "routing.colocation.prepared",
            "Ana Rutas",
            "compactación de paradas",
            "Ana Rutas detectó que una camioneta salía de un punto físico para volver después. Medirá también la variante que atiende juntos los clientes ubicados exactamente en ese punto cuando conserva la precedencia de prioridades.",
          );
        const spatial = spatialSequenceCandidate(
          board.shipments,
          compacted,
          settings.depotLocation!,
        );
        if (JSON.stringify(spatial.routes) !== JSON.stringify(compacted.routes))
          progress(
            "info",
            "routing.spatial_search.prepared",
            "Ana Rutas",
            "búsqueda de secuencia",
            "Ana Rutas aplicó relocate y 2-opt dentro de las prioridades hasta que ninguna mejora geométrica adicional fue posible; Google Routes medirá el resultado antes de decidir.",
            { allocationSource: allocation.source },
          );
        await measure(allocation.source, sequencedCandidate);
        await measure(allocation.source, spatial);
      }
      if (evaluations.some((evaluation) => evaluation.value.lateStops > 0)) {
        progress(
          "info",
          "routing.deadline.started",
          "Ana Rutas",
          "reparación de ventanas",
          "Ana Rutas detectó retrasos y medirá también una secuencia por prioridad y hora límite, sin cambiar pedidos de camioneta.",
          {
            evaluatedCandidates: evaluations.length,
            lateStops: evaluations.reduce(
              (total, item) => total + item.value.lateStops,
              0,
            ),
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
          planner: "google-deterministic-v2",
          evaluatedCandidates: evaluations.length,
          candidateSources: evaluations.map((item) => item.source),
          chosenSource: winner.source,
          deliveryGroups: snapshot.deliveryGroups.length,
          logisticsPolicy: logisticsPolicyVersion,
          score: winner.value.score,
        },
      );
      progress(
        "info",
        "routing.completed",
        "PostgreSQL",
        "terminado",
        `Ruta terminada: ${saved?.metrics.performedShipmentCount ?? 0} pedidos quedaron guardados, sin llamadas a OpenAI y sin omisiones parciales.`,
        {
          stepDurationMs: Math.round(performance.now() - databaseStarted),
          assignedOrders: saved?.metrics.performedShipmentCount ?? 0,
          skippedOrders: saved?.skipped.length ?? 0,
          routes: saved?.routes.length ?? 0,
          evaluatedCandidates: evaluations.length,
          distanceMeters: saved?.metrics.travelDistanceMeters ?? 0,
          durationSeconds: saved?.metrics.totalDurationSeconds ?? 0,
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
