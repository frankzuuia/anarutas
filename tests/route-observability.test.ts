import { describe, expect, it, vi } from "vitest";
import {
  createRoutingLogger,
  type RoutingLogDetails,
  type RoutingLogEntry,
} from "../src/core/route-observability";

describe("natural EasyPanel routing observability", () => {
  it("writes correlated natural-language JSON to the appropriate console stream", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const now = vi
      .fn()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_025)
      .mockReturnValueOnce(1_050)
      .mockReturnValueOnce(1_075);
    const log = createRoutingLogger("request-qa", "plan-qa", undefined, now);

    log(
      "info",
      "routing.started",
      "Ana Rutas",
      "preparación",
      "Ana Rutas está preparando los pedidos.",
      { orders: 61 },
    );
    log(
      "warning",
      "routing.warning",
      "Google Route Optimization",
      "optimización vial",
      "Google devolvió una advertencia y el proceso continúa.",
    );
    log(
      "error",
      "routing.failed",
      "PostgreSQL",
      "guardado transaccional",
      "El guardado se detuvo y el borrador quedó intacto.",
      { errorCode: "VERSION_CONFLICT" },
    );

    expect(JSON.parse(String(info.mock.calls[0][0]))).toEqual({
      message: "Ana Rutas está preparando los pedidos.",
      event: "routing.started",
      level: "info",
      system: "Ana Rutas",
      stage: "preparación",
      requestId: "request-qa",
      planId: "plan-qa",
      elapsedMs: 25,
      details: { orders: 61 },
    });
    expect(warning).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
    info.mockRestore();
    warning.mockRestore();
    error.mockRestore();
  });

  it("drops unapproved details and never lets logging interrupt routing", () => {
    const entries: RoutingLogEntry[] = [];
    const permitted: Required<RoutingLogDetails> = {
      expectedVersion: 1,
      orders: 61,
      deliveryGroups: 49,
      vehicles: 4,
      solverTimeoutSeconds: 60,
      allocationSource: "Google",
      precedenceRules: 12,
      skippedDestinations: 0,
      priorityConflictOrders: 0,
      assignmentChanged: false,
      evaluatedCandidates: 2,
      stepDurationMs: 750,
      segmentsCompleted: 14,
      segmentsTotal: 70,
      assignedOrders: 61,
      skippedOrders: 0,
      routes: 4,
      lateStops: 2,
      lateSeconds: 900,
      priorityConflicts: 1,
      unusedVehicles: 0,
      ordersPerRoute: [15, 15, 15, 15],
      destinationsPerRoute: [15, 15, 15, 15],
      chosenOrdersPerRoute: [15, 15, 15, 15],
      maxOrders: 15,
      orderImbalance: 0,
      maxDestinations: 15,
      destinationImbalance: 0,
      distanceMeters: 12_500,
      durationSeconds: 3_600,
      errorCode: "VERSION_CONFLICT",
    };
    const details = {
      ...permitted,
      apiKey: "must-not-appear",
      customerAddress: "must-not-appear",
    } as RoutingLogDetails;
    const log = createRoutingLogger(
      "request-qa",
      "plan-qa",
      (entry) => entries.push(entry),
      () => 0,
    );
    log(
      "info",
      "routing.safe",
      "Ana Rutas",
      "seguridad",
      "El registro sólo contiene métricas autorizadas.",
      details,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].details).toEqual(permitted);
    expect(Object.keys(entries[0].details).sort()).toEqual(
      Object.keys(permitted).sort(),
    );
    log(
      "info",
      "routing.partial",
      "Ana Rutas",
      "seguridad",
      "Sólo se conservan los campos presentes.",
      { orders: 1 },
    );
    expect(entries[1].details).toEqual({ orders: 1 });
    expect(Object.keys(entries[1].details)).toEqual(["orders"]);
    expect(JSON.stringify(entries)).not.toContain("must-not-appear");

    const broken = createRoutingLogger(
      "request-qa",
      "plan-qa",
      () => {
        throw new Error("LOGGER_DOWN");
      },
      () => 0,
    );
    expect(() =>
      broken(
        "info",
        "routing.safe",
        "Ana Rutas",
        "seguridad",
        "El ruteo continúa aunque el destino del log falle.",
      ),
    ).not.toThrow();
  });
});
