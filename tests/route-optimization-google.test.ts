import { describe, expect, it, vi } from "vitest";
import type { OrderBoard, Shipment } from "../src/core/orders-contract";
import type { Vehicle } from "../src/core/fleet-contract";
import type { GoogleServiceAccount } from "../src/core/routing-config";
import type { RoutingSettings } from "../src/core/routing-contract";
import {
  buildGoogleOptimizationRequest,
  localMinuteInstant,
  optimizationTimeoutSeconds,
  parseGoogleOptimizationResponse,
  requestGoogleOptimization,
} from "../src/core/route-optimization-google";

const googleAuthMock = vi.hoisted(() => ({
  constructor: vi.fn(),
  getAccessToken: vi.fn(),
}));

vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    constructor(options: unknown) {
      googleAuthMock.constructor(options);
    }

    getAccessToken() {
      return googleAuthMock.getAccessToken();
    }
  },
}));

const ids = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
];
const vehicle: Vehicle = {
  id: "00000000-0000-4000-8000-000000000010",
  name: "Ford 2025",
  brand: "Ford",
  model: "2025",
  plate: "QA-001",
  mileage: "10",
  fuel: "Gasolina",
  available: true,
  driver_id: null,
  driver_name: null,
  version: 1,
};
function shipment(id: string, priority: Shipment["priority"]): Shipment {
  return {
    id,
    pickingId: Number(id.slice(-2)),
    pickingName: `WH/OUT/${id.slice(-2)}`,
    orderId: Number(id.slice(-2)),
    orderName: `S${id.slice(-2)}`,
    partnerId: Number(id.slice(-2)),
    customerName: `Cliente ${id.slice(-2)}`,
    address: "Guadalajara, Jalisco",
    validatedAt: "2026-09-09T03:47:40.000Z",
    promisedAt: null,
    backorderId: null,
    lines: [],
    vehicle_id: null,
    position: 1,
    window_start: "09:00",
    window_end: "12:00",
    high_priority: priority === "high",
    priority,
    deliveryWindows: [{ startMinute: 540, endMinute: 720 }],
    deliveryNote: "",
    phone: null,
    fulfillmentMode: "delivery",
    mapUrl: null,
    latitude: 20.6597,
    longitude: -103.3496,
    locationStatus: "confirmed",
    customerArchived: false,
  };
}
const settings: RoutingSettings = {
  depotAddress:
    "Calle 5 1106, Colonia Industrial, Guadalajara, Jalisco, México",
  depotLocation: {
    latitude: 20.624,
    longitude: -103.354,
    placeId: "qa-place",
  },
  version: 1,
  updatedAt: "2026-09-10T00:00:00.000Z",
};
const credentials: GoogleServiceAccount = {
  type: "service_account",
  project_id: "ana-rutas-develop",
  client_email: "ana-rutas-routing@ana-rutas-develop.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nQA\n-----END PRIVATE KEY-----\n",
  token_uri: "https://oauth2.googleapis.com/token",
};
function board(): OrderBoard {
  return {
    plan: {
      id: "00000000-0000-4000-8000-000000000020",
      service_date: "2026-09-09",
      departure_minute: 450,
      label: "QA",
      version: 1,
      updated_at: "2026-09-09T00:00:00.000Z",
    },
    vehicles: [vehicle],
    shipments: [
      shipment(ids[0], "high"),
      shipment(ids[1], "medium"),
      shipment(ids[2], "schedule"),
    ],
  };
}

describe("Google Route Optimization contract", () => {
  it("requests an OAuth token with the cloud-platform scope", async () => {
    googleAuthMock.constructor.mockClear();
    googleAuthMock.getAccessToken.mockReset();
    googleAuthMock.getAccessToken.mockResolvedValueOnce("qa-oauth-token");
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ routes: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const request = buildGoogleOptimizationRequest(
      board(),
      settings,
      "America/Mexico_City",
    );

    await expect(
      requestGoogleOptimization("ana-rutas-develop", credentials, request, {
        fetch: fetcher as typeof fetch,
      }),
    ).resolves.toEqual({ routes: [] });

    expect(googleAuthMock.constructor).toHaveBeenCalledWith({
      credentials,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://routeoptimization.googleapis.com/v1/projects/ana-rutas-develop:optimizeTours",
    );
    expect(options.headers).toEqual({
      Authorization: "Bearer qa-oauth-token",
      "Content-Type": "application/json",
    });
  });

  it("fails closed before the Google request when OAuth returns no token", async () => {
    googleAuthMock.getAccessToken.mockReset();
    googleAuthMock.getAccessToken.mockResolvedValueOnce(null);
    const fetcher = vi.fn();

    await expect(
      requestGoogleOptimization(
        "ana-rutas-develop",
        credentials,
        buildGoogleOptimizationRequest(
          board(),
          settings,
          "America/Mexico_City",
        ),
        { fetch: fetcher as typeof fetch },
      ),
    ).rejects.toMatchObject({
      code: "ROUTING_GOOGLE_DENIED",
      status: 503,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("builds a real-road model with fixed departure, warehouse return and no weight fields", () => {
    const request = buildGoogleOptimizationRequest(
      board(),
      settings,
      "America/Mexico_City",
    );
    expect(request).toEqual({
      timeout: "5s",
      considerRoadTraffic: true,
      populatePolylines: true,
      populateTransitionPolylines: true,
      model: {
        globalStartTime: "2026-09-09T13:30:00.000Z",
        globalEndTime: "2026-09-10T06:00:00Z",
        shipments: ids.map((id) => ({
          label: id,
          deliveries: [
            {
              label: id,
              arrivalLocation: {
                latitude: 20.6597,
                longitude: -103.3496,
              },
              timeWindows: [
                {
                  startTime: "2026-09-09T15:00:00.000Z",
                  endTime: "2026-09-09T18:00:00.000Z",
                },
              ],
            },
          ],
        })),
        vehicles: [
          {
            label: vehicle.id,
            travelMode: "DRIVING",
            startLocation: { latitude: 20.624, longitude: -103.354 },
            endLocation: { latitude: 20.624, longitude: -103.354 },
            costPerHour: 1,
            startTimeWindows: [
              {
                startTime: "2026-09-09T13:30:00.000Z",
                endTime: "2026-09-09T13:30:00.000Z",
              },
            ],
          },
        ],
        precedenceRules: [
          {
            firstIsDelivery: true,
            secondIsDelivery: true,
            firstIndex: 0,
            secondIndex: 1,
          },
          {
            firstIsDelivery: true,
            secondIsDelivery: true,
            firstIndex: 0,
            secondIndex: 2,
          },
          {
            firstIsDelivery: true,
            secondIsDelivery: true,
            firstIndex: 1,
            secondIndex: 2,
          },
        ],
      },
    });
    expect(JSON.stringify(request)).not.toContain("loadLimit");
    expect(JSON.stringify(request)).not.toContain("loadDemand");
    expect(request.model.vehicles[0].endLocation).toEqual(
      request.model.vehicles[0].startLocation,
    );
  });

  it("converts civil minutes through timezone offsets and DST", () => {
    expect(localMinuteInstant("2026-09-09", 0, "America/Mexico_City")).toBe(
      "2026-09-09T06:00:00.000Z",
    );
    expect(localMinuteInstant("2026-09-09", 1, "America/Mexico_City")).toBe(
      "2026-09-09T06:01:00.000Z",
    );
    expect(localMinuteInstant("2026-09-09", 660, "America/Mexico_City")).toBe(
      "2026-09-09T17:00:00.000Z",
    );
    expect(localMinuteInstant("2026-03-08", 210, "America/New_York")).toBe(
      "2026-03-08T07:30:00.000Z",
    );
    expect(localMinuteInstant("2026-09-09", 1439, "America/Mexico_City")).toBe(
      "2026-09-10T05:59:00.000Z",
    );
    for (const minute of [-1, 0.5, Number.NaN, 1440])
      expect(() =>
        localMinuteInstant("2026-09-09", minute, "America/Mexico_City"),
      ).toThrow("ROUTING_MODEL_INVALID");
    expect(() =>
      localMinuteInstant("2026-03-08", 150, "America/New_York"),
    ).toThrow("DATE_BOUNDARY_UNSUPPORTED");
  });

  it("rejects missing operational inputs and ignores pickup or archived records", () => {
    const value = board();
    expect(() =>
      buildGoogleOptimizationRequest(
        value,
        { ...settings, depotLocation: null },
        "UTC",
      ),
    ).toThrow("ROUTING_ORIGIN_REQUIRED");
    expect(() =>
      buildGoogleOptimizationRequest(
        { ...value, vehicles: [] },
        settings,
        "UTC",
      ),
    ).toThrow("ROUTING_VEHICLES_REQUIRED");
    expect(() =>
      buildGoogleOptimizationRequest(
        { ...value, shipments: [] },
        settings,
        "UTC",
      ),
    ).toThrow("ROUTING_ORDERS_REQUIRED");
    expect(() =>
      buildGoogleOptimizationRequest(
        { ...value, plan: { ...value.plan, departure_minute: null } },
        settings,
        "UTC",
      ),
    ).toThrow("ROUTING_DEPARTURE_REQUIRED");
    expect(() =>
      buildGoogleOptimizationRequest(
        {
          ...value,
          shipments: [
            {
              ...value.shipments[0],
              latitude: null,
              locationStatus: "pending",
            },
          ],
        },
        settings,
        "UTC",
      ),
    ).toThrow("ROUTING_POINTS_REQUIRED");
    let pointError: unknown;
    try {
      buildGoogleOptimizationRequest(
        {
          ...value,
          shipments: value.shipments.slice(0, 2).map((shipment) => ({
            ...shipment,
            locationStatus: "pending" as const,
          })),
        },
        settings,
        "UTC",
      );
    } catch (caught) {
      pointError = caught;
    }
    expect(pointError).toMatchObject({
      message: "ROUTING_POINTS_REQUIRED",
      status: 409,
      details: { count: 2 },
    });
    for (const invalid of [
      {
        ...value.shipments[0],
        latitude: null,
        locationStatus: "confirmed" as const,
      },
      {
        ...value.shipments[0],
        longitude: null,
        locationStatus: "confirmed" as const,
      },
      { ...value.shipments[0], locationStatus: "pending" as const },
    ])
      expect(() =>
        buildGoogleOptimizationRequest(
          { ...value, shipments: [invalid] },
          settings,
          "UTC",
        ),
      ).toThrow("ROUTING_POINTS_REQUIRED");
    const filtered = buildGoogleOptimizationRequest(
      {
        ...value,
        shipments: [
          value.shipments[0],
          {
            ...value.shipments[1],
            fulfillmentMode: "pickup",
            latitude: null,
            longitude: null,
            locationStatus: "pending",
          },
          { ...value.shipments[2], customerArchived: true, latitude: null },
        ],
      },
      settings,
      "UTC",
    );
    expect(filtered.model.shipments).toHaveLength(1);
    expect(filtered.model.shipments[0].label).toBe(value.shipments[0].id);
    expect(() =>
      buildGoogleOptimizationRequest(
        {
          ...value,
          shipments: value.shipments.map((shipment) => ({
            ...shipment,
            customerArchived: true,
          })),
        },
        settings,
        "UTC",
      ),
    ).toThrow("ROUTING_ORDERS_REQUIRED");
  });

  it("uses Google's published constrained timeout bands", () => {
    expect([8, 32, 100, 1000, 10000].map(optimizationTimeoutSeconds)).toEqual([
      5, 20, 60, 180, 900,
    ]);
    expect(optimizationTimeoutSeconds(1001)).toBe(900);
    expect(optimizationTimeoutSeconds(10001)).toBe(1020);
    expect(optimizationTimeoutSeconds(20000)).toBe(1020);
    expect(optimizationTimeoutSeconds(1000000)).toBe(1800);
  });

  it("accepts omitted protobuf zero indices and sanitizes route output", () => {
    const result = parseGoogleOptimizationResponse(
      {
        routes: [
          {
            vehicleStartTime: "2026-09-09T13:30:00Z",
            vehicleEndTime: "2026-09-09T13:37:30Z",
            visits: [{ startTime: "2026-09-09T15:15:00Z" }],
            transitions: [
              {
                travelDistanceMeters: "1250",
                travelDuration: "420s",
                waitDuration: "30s",
                routePolyline: { points: "leg" },
                routeToken: "private-token",
              },
            ],
            routePolyline: { points: "route" },
            metrics: {
              performedShipmentCount: 1,
              travelDistanceMeters: "1250",
              travelDuration: "420s",
              waitDuration: "30s",
              totalDuration: "450s",
            },
          },
        ],
        metrics: {
          aggregatedRouteMetrics: {
            performedShipmentCount: 1,
            travelDistanceMeters: "1250",
            travelDuration: "420s",
            waitDuration: "30s",
            totalDuration: "450s",
          },
        },
      },
      1,
      1,
    );
    expect(result).toEqual({
      routes: [
        {
          vehicleIndex: 0,
          departureAt: "2026-09-09T13:30:00.000Z",
          finishedAt: "2026-09-09T13:37:30.000Z",
          encodedPolyline: "route",
          metrics: {
            travelDistanceMeters: 1250,
            travelDurationSeconds: 420,
            waitDurationSeconds: 30,
            totalDurationSeconds: 450,
            performedShipmentCount: 1,
          },
          visits: [
            {
              shipmentIndex: 0,
              eta: "2026-09-09T15:15:00.000Z",
              travelDistanceMeters: 1250,
              travelDurationSeconds: 420,
              waitDurationSeconds: 30,
            },
          ],
          transitions: [
            { encodedPolyline: "leg", routeToken: "private-token" },
          ],
        },
      ],
      skipped: [],
      metrics: {
        travelDistanceMeters: 1250,
        travelDurationSeconds: 420,
        waitDurationSeconds: 30,
        totalDurationSeconds: 450,
        performedShipmentCount: 1,
      },
    });
  });

  it("preserves protobuf zero defaults and rejects malformed scalar metrics", () => {
    const zero = parseGoogleOptimizationResponse(
      {
        routes: [
          {
            visits: [{ startTime: "2026-09-09T15:15:00Z" }],
            transitions: [{ routePolyline: { points: 7 }, routeToken: 9 }],
            routePolyline: { points: 7 },
            metrics: { performedShipmentCount: "1" },
          },
        ],
        metrics: {
          aggregatedRouteMetrics: { performedShipmentCount: "1" },
        },
      },
      1,
      1,
    );
    expect(zero.routes[0]).toEqual({
      vehicleIndex: 0,
      encodedPolyline: null,
      metrics: {
        travelDistanceMeters: 0,
        travelDurationSeconds: 0,
        waitDurationSeconds: 0,
        totalDurationSeconds: 0,
        performedShipmentCount: 1,
      },
      visits: [
        {
          shipmentIndex: 0,
          eta: "2026-09-09T15:15:00.000Z",
          travelDistanceMeters: 0,
          travelDurationSeconds: 0,
          waitDurationSeconds: 0,
        },
      ],
      transitions: [{ encodedPolyline: null, routeToken: null }],
    });
    for (const invalidMetric of ["", "not-a-number", "1e3", -1, 1.5])
      expect(() =>
        parseGoogleOptimizationResponse(
          {
            routes: [
              {
                visits: [{ startTime: "2026-09-09T15:15:00Z" }],
                transitions: [{ travelDistanceMeters: invalidMetric }],
                metrics: { performedShipmentCount: 1 },
              },
            ],
            metrics: { aggregatedRouteMetrics: { performedShipmentCount: 1 } },
          },
          1,
          1,
        ),
      ).toThrow("ROUTING_RESPONSE_INVALID");
    for (const invalidDuration of [7, "420", "minutes", "-1s", "Infinitys"])
      expect(() =>
        parseGoogleOptimizationResponse(
          {
            routes: [
              {
                visits: [{ startTime: "2026-09-09T15:15:00Z" }],
                transitions: [{ travelDuration: invalidDuration }],
                metrics: { performedShipmentCount: 1 },
              },
            ],
            metrics: { aggregatedRouteMetrics: { performedShipmentCount: 1 } },
          },
          1,
          1,
        ),
      ).toThrow("ROUTING_RESPONSE_INVALID");
  });

  it("normalizes Google omissions with only approved reason codes", () => {
    const approved = [
      "NO_VEHICLE",
      "DEMAND_EXCEEDS_VEHICLE_CAPACITY",
      "CANNOT_BE_PERFORMED_WITHIN_VEHICLE_DISTANCE_LIMIT",
      "CANNOT_BE_PERFORMED_WITHIN_VEHICLE_DURATION_LIMIT",
      "CANNOT_BE_PERFORMED_WITHIN_VEHICLE_TRAVEL_DURATION_LIMIT",
      "CANNOT_BE_PERFORMED_WITHIN_VEHICLE_TIME_WINDOWS",
      "VEHICLE_NOT_ALLOWED",
      "VEHICLE_IGNORED",
      "SHIPMENT_IGNORED",
      "SKIPPED_IN_INJECTED_SOLUTION_CONSTRAINT",
      "VEHICLE_ROUTE_IS_FULLY_SEQUENCE_CONSTRAINED",
      "ZERO_PENALTY_COST",
    ];
    const result = parseGoogleOptimizationResponse(
      {
        routes: [],
        skippedShipments: [
          {
            index: 0,
            reasons: [
              ...approved.map((code) => ({ code })),
              { code: "INTERNAL_DETAIL_NOT_EXPOSED" },
            ],
          },
        ],
        metrics: { aggregatedRouteMetrics: {} },
      },
      1,
      1,
    );
    expect(result).toMatchObject({
      routes: [],
      skipped: [
        {
          shipmentIndex: 0,
          reasons: approved,
        },
      ],
      metrics: { performedShipmentCount: 0 },
    });
    for (const reasons of [undefined, null, "bad", [], [null, [], { code: 7 }]])
      expect(
        parseGoogleOptimizationResponse(
          {
            routes: [],
            skippedShipments: [{ reasons }],
            metrics: { aggregatedRouteMetrics: {} },
          },
          1,
          1,
        ).skipped[0].reasons,
      ).toEqual(["UNSPECIFIED"]);
  });

  it.each([
    { vehicleIndex: 1 },
    { vehicleIndex: 1, visits: [], metrics: {} },
    { vehicleIndex: 1, transitions: [] },
    { vehicleIndex: 1, visits: null, transitions: null },
  ])(
    "accepts a ProtoJSON unused vehicle without losing shipment coverage: %j",
    (unused) => {
      const routes = [
        {
          visits: Array.from({ length: 7 }, (_, shipmentIndex) => ({
            shipmentIndex,
            startTime: "2026-09-11T15:00:00Z",
          })),
          transitions: Array.from({ length: 8 }, () => ({})),
          metrics: { performedShipmentCount: 7 },
        },
        unused,
      ];
      const response = {
        routes,
        metrics: { aggregatedRouteMetrics: { performedShipmentCount: 7 } },
      };
      const parsed = parseGoogleOptimizationResponse(response, 7, 2);
      expect(parsed.routes[1]).toMatchObject({
        vehicleIndex: 1,
        visits: [],
        transitions: [],
        metrics: { performedShipmentCount: 0, totalDurationSeconds: 0 },
      });
      expect(
        parsed.routes[0].visits.map((visit) => visit.shipmentIndex),
      ).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(() => parseGoogleOptimizationResponse(response, 8, 2)).toThrow(
        "ROUTING_RESPONSE_INVALID",
      );
    },
  );

  it("accepts omitted empty routes only with complete skipped coverage and valid aggregate metrics", () => {
    const response = {
      skippedShipments: [{}],
      metrics: { aggregatedRouteMetrics: {} },
    };
    expect(parseGoogleOptimizationResponse(response, 1, 2)).toMatchObject({
      routes: [],
      skipped: [{ shipmentIndex: 0 }],
      metrics: { performedShipmentCount: 0 },
    });
    expect(() => parseGoogleOptimizationResponse(response, 2, 2)).toThrow(
      "ROUTING_RESPONSE_INVALID",
    );
  });

  it("identifies the rejected field without including provider contents", () => {
    const response = {
      routes: [
        {
          visits: [{ startTime: "2026-09-11T15:00:00Z" }],
          transitions: [{}],
          metrics: { performedShipmentCount: 1 },
        },
      ],
      metrics: { aggregatedRouteMetrics: { performedShipmentCount: 1 } },
    };
    const check = (value: unknown, field: string) => {
      let failure: unknown;
      try {
        parseGoogleOptimizationResponse(value, 1, 2);
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({
        code: "ROUTING_RESPONSE_INVALID",
        details: { field },
      });
    };
    check(
      { ...response, routes: "PRIVATE_RESPONSE" },
      "routes/skippedShipments",
    );
    check(
      { ...response, routes: [{ ...response.routes[0], transitions: [] }] },
      "route.transitions.count",
    );
    check(
      { ...response, routes: [{ ...response.routes[0], visits: {} }] },
      "route.visits/transitions",
    );
    check(
      { ...response, routes: [{ ...response.routes[0], metrics: undefined }] },
      "route.metrics",
    );
    check(
      {
        ...response,
        routes: [
          { ...response.routes[0], metrics: { performedShipmentCount: 0 } },
        ],
      },
      "route.metrics.performedShipmentCount",
    );
    check({ ...response, routes: [] }, "shipments.coverage");
    check({ ...response, metrics: {} }, "metrics.aggregatedRouteMetrics");
    check(
      { ...response, metrics: { aggregatedRouteMetrics: {} } },
      "metrics.performedShipmentCount",
    );
  });

  it("rejects duplicate, missing and out-of-range shipment coverage", () => {
    expect(() =>
      parseGoogleOptimizationResponse(
        { routes: [{ visits: [], transitions: [] }] },
        1,
        1,
      ),
    ).toThrow("ROUTING_RESPONSE_INVALID");
    expect(() =>
      parseGoogleOptimizationResponse(
        {
          routes: [
            {
              visits: [{ shipmentIndex: 2, startTime: "2026-09-09T15:00:00Z" }],
              transitions: [{}],
            },
          ],
        },
        1,
        1,
      ),
    ).toThrow("ROUTING_RESPONSE_INVALID");
    expect(() =>
      parseGoogleOptimizationResponse(
        {
          routes: [
            {
              visits: [{ startTime: "2026-09-09T15:00:00Z" }],
              transitions: [],
              metrics: { performedShipmentCount: 1 },
            },
          ],
          metrics: {
            aggregatedRouteMetrics: { performedShipmentCount: 1 },
          },
        },
        1,
        1,
      ),
    ).toThrow("ROUTING_RESPONSE_INVALID");
  });

  it("rejects every malformed Google response envelope before persistence", () => {
    const invalid = (value: unknown, shipments = 0, vehicles = 1) =>
      expect(() =>
        parseGoogleOptimizationResponse(value, shipments, vehicles),
      ).toThrow("ROUTING_RESPONSE_INVALID");
    for (const root of [null, [], "bad", {}, { routes: {} }]) invalid(root);
    invalid({ routes: [], skippedShipments: {} });
    for (const badMetrics of [undefined, null, [], "bad"])
      invalid({ routes: [], metrics: badMetrics });
    invalid({ routes: [], metrics: { aggregatedRouteMetrics: "bad" } });
    invalid({
      routes: [{ visits: [], transitions: [], metrics: "bad" }],
      metrics: { aggregatedRouteMetrics: {} },
    });
    invalid({ routes: [], metrics: { aggregatedRouteMetrics: {} } }, 1);
    for (const route of [null, [], "bad"]) invalid({ routes: [route] });
    invalid({ routes: [{}] });
    invalid({ routes: [{ visits: [], transitions: {}, metrics: {} }] });
    invalid({ routes: [{ visits: {}, transitions: [], metrics: {} }] });
    for (const route of [
      {
        vehicleStartTime: 7,
        visits: [],
        transitions: [],
        metrics: {},
      },
      {
        vehicleStartTime: "not-a-date",
        visits: [],
        transitions: [],
        metrics: {},
      },
      {
        vehicleEndTime: 7,
        visits: [],
        transitions: [],
        metrics: {},
      },
      {
        vehicleEndTime: "not-a-date",
        visits: [],
        transitions: [],
        metrics: {},
      },
    ])
      invalid({
        routes: [route],
        metrics: { aggregatedRouteMetrics: {} },
      });
    invalid(
      {
        routes: [
          { visits: [], transitions: [], metrics: {} },
          { visits: [], transitions: [], metrics: {} },
        ],
        metrics: { aggregatedRouteMetrics: {} },
      },
      0,
      2,
    );
    invalid(
      {
        routes: [{ vehicleIndex: 1, visits: [], transitions: [], metrics: {} }],
        metrics: { aggregatedRouteMetrics: {} },
      },
      0,
      1,
    );
    for (const visit of [null, [], "bad"])
      invalid(
        {
          routes: [
            {
              visits: [visit],
              transitions: [{}],
              metrics: { performedShipmentCount: 1 },
            },
          ],
          metrics: {
            aggregatedRouteMetrics: { performedShipmentCount: 1 },
          },
        },
        1,
      );
    for (const visit of [
      {},
      { startTime: 7 },
      { startTime: "not-a-date" },
      { shipmentIndex: 1, startTime: "2026-09-09T15:00:00Z" },
      { shipmentIndex: -1, startTime: "2026-09-09T15:00:00Z" },
      { shipmentIndex: 0.5, startTime: "2026-09-09T15:00:00Z" },
      { shipmentIndex: "x", startTime: "2026-09-09T15:00:00Z" },
    ])
      invalid(
        {
          routes: [
            {
              visits: [visit],
              transitions: [{}],
              metrics: { performedShipmentCount: 1 },
            },
          ],
          metrics: {
            aggregatedRouteMetrics: { performedShipmentCount: 1 },
          },
        },
        1,
      );
    invalid(
      {
        routes: [
          {
            visits: [
              { startTime: "2026-09-09T15:00:00Z" },
              { startTime: "2026-09-09T16:00:00Z" },
            ],
            transitions: [{}, {}],
            metrics: { performedShipmentCount: 2 },
          },
        ],
        skippedShipments: [{ index: 1 }],
        metrics: { aggregatedRouteMetrics: { performedShipmentCount: 2 } },
      },
      2,
    );
    for (const transition of [null, [], "bad"])
      invalid(
        {
          routes: [
            {
              visits: [{ startTime: "2026-09-09T15:00:00Z" }],
              transitions: [transition],
              metrics: { performedShipmentCount: 1 },
            },
          ],
          metrics: {
            aggregatedRouteMetrics: { performedShipmentCount: 1 },
          },
        },
        1,
      );
    invalid(
      {
        routes: [
          {
            visits: [{ startTime: "2026-09-09T15:00:00Z" }],
            transitions: [{}],
            metrics: { performedShipmentCount: 0 },
          },
        ],
        metrics: { aggregatedRouteMetrics: { performedShipmentCount: 1 } },
      },
      1,
    );
    for (const skipped of [null, [], "bad"])
      invalid(
        {
          routes: [],
          skippedShipments: [skipped],
          metrics: { aggregatedRouteMetrics: {} },
        },
        1,
      );
    invalid(
      {
        routes: [],
        skippedShipments: [{ index: 1 }],
        metrics: { aggregatedRouteMetrics: {} },
      },
      1,
    );
    invalid(
      {
        routes: [
          {
            visits: [{ startTime: "2026-09-09T15:00:00Z" }],
            transitions: [{}],
            metrics: { performedShipmentCount: 1 },
          },
        ],
        skippedShipments: [{}],
        metrics: { aggregatedRouteMetrics: { performedShipmentCount: 1 } },
      },
      1,
    );
    invalid(
      {
        routes: [
          {
            visits: [{ startTime: "2026-09-09T15:00:00Z" }],
            transitions: [{}],
            metrics: { performedShipmentCount: 1 },
          },
        ],
        metrics: { aggregatedRouteMetrics: { performedShipmentCount: 0 } },
      },
      1,
    );
  });
});
