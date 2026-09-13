import type { OrderBoard, Shipment } from "./orders-contract";
import type { PublicOptimization } from "./routing-contract";
import { deliveryGroups } from "./route-delivery-groups";

type IncidentShipment = Pick<
  Shipment,
  | "id"
  | "partnerId"
  | "fulfillmentMode"
  | "customerArchived"
  | "customerName"
  | "orderName"
  | "pickingName"
  | "deliveryWindows"
>;
type IncidentBoard = {
  plan: Pick<OrderBoard["plan"], "id" | "version">;
  shipments: IncidentShipment[];
  vehicles: Pick<
    OrderBoard["vehicles"][number],
    "id" | "name" | "driver_name"
  >[];
};
export type ForecastIncident = {
  destinationId: string;
  customer: string;
  orders: string[];
  vehicle: string;
  driver: string | null;
  windows: Shipment["deliveryWindows"];
  eta: string;
  lateSeconds: number;
};
export type IncidentReport = ReturnType<typeof forecastIncidents> & {
  plan: OrderBoard["plan"];
};

// A read model only. These are forecasts, never proof that a driver arrived.
export function forecastIncidents(
  board: IncidentBoard,
  calculation: PublicOptimization | null,
) {
  const rows: ForecastIncident[] = [];
  if (!calculation) return { kind: "missing" as const, rows, unmeasured: 0 };
  if (
    !calculation.current ||
    calculation.planId !== board.plan.id ||
    calculation.appliedPlanVersion !== board.plan.version
  )
    return { kind: "stale" as const, rows, unmeasured: 0 };
  const byId = new Map(board.shipments.map((s) => [s.id, s]));
  const visits = new Map(
    calculation.routes.flatMap((route) =>
      route.stops.map((stop) => [stop.shipmentId, { route, stop }] as const),
    ),
  );
  const vehicles = new Map(board.vehicles.map((v) => [v.id, v]));
  let unmeasured = 0;
  for (const group of deliveryGroups(board.shipments)) {
    const members = group.shipmentIds.map((id) => visits.get(id));
    if (members.some((v) => v?.stop.lateSeconds === undefined)) {
      unmeasured++;
      continue;
    }
    const late = members
      .map((v) => v!)
      .sort((a, b) => b.stop.lateSeconds! - a.stop.lateSeconds!)[0];
    if (late.stop.lateSeconds! <= 0) continue;
    const shipment = byId.get(late.stop.shipmentId)!;
    rows.push({
      destinationId: group.id,
      customer: shipment.customerName,
      orders: [
        ...new Set(
          group.shipmentIds.map((id) => {
            const member = byId.get(id)!;
            return member.orderName || member.pickingName;
          }),
        ),
      ],
      vehicle: late.route.vehicleName,
      driver: vehicles.get(late.route.vehicleId)?.driver_name ?? null,
      windows: shipment.deliveryWindows,
      eta: late.stop.eta,
      lateSeconds: late.stop.lateSeconds!,
    });
  }
  rows.sort(
    (a, b) =>
      b.lateSeconds - a.lateSeconds || a.customer.localeCompare(b.customer),
  );
  return { kind: "ready" as const, rows, unmeasured };
}
