export type RoutingSettings = {
  depotAddress: string;
  depotLocation: {
    latitude: number;
    longitude: number;
    placeId: string | null;
  } | null;
  version: number;
  updatedAt: string | null;
};

export type RouteMetrics = {
  travelDistanceMeters: number;
  travelDurationSeconds: number;
  waitDurationSeconds: number;
  totalDurationSeconds: number;
  performedShipmentCount: number;
};

export type PublicOptimizedRoute = {
  vehicleId: string;
  vehicleName: string;
  encodedPolyline: string | null;
  segmentPolylines?: string[];
  departureAt?: string;
  finishedAt?: string;
  trafficMode?: "forecast" | "static";
  metrics: RouteMetrics;
  stops: {
    shipmentId: string;
    position: number;
    eta: string;
    travelDistanceMeters: number;
    travelDurationSeconds: number;
    waitDurationSeconds: number;
    lateSeconds?: number;
    priorityConflict?: boolean;
  }[];
};

export type PublicOptimization = {
  runId: string;
  planId: string;
  appliedPlanVersion: number;
  current: boolean;
  createdAt: string;
  metrics: RouteMetrics;
  routes: PublicOptimizedRoute[];
  skipped: { shipmentId: string; reasons: string[] }[];
  recalculation?: {
    status: "pending" | "running" | "failed";
    errorCode: string | null;
  } | null;
};
