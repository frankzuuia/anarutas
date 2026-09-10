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
  metrics: RouteMetrics;
  stops: {
    shipmentId: string;
    position: number;
    eta: string;
    travelDistanceMeters: number;
    travelDurationSeconds: number;
    waitDurationSeconds: number;
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
};
