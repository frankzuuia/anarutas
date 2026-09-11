import { createHash } from "node:crypto";
import type { OrderBoard } from "./orders-contract";

export function routeFingerprint(board: OrderBoard, settingsVersion: number) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        policy: "warehouse-return-v1",
        date: board.plan.service_date,
        departure: board.plan.departure_minute ?? null,
        settingsVersion,
        vehicles: board.vehicles.map((v) => ({
          id: v.id,
          name: v.name,
          driver: v.driver_id,
        })),
        shipments: board.shipments.map((s) => ({
          id: s.id,
          vehicle: s.vehicle_id,
          position: s.position,
          latitude: s.latitude,
          longitude: s.longitude,
          windows: s.deliveryWindows,
          priority: s.priority,
          mode: s.fulfillmentMode,
          archived: s.customerArchived,
          locationStatus: s.locationStatus,
        })),
      }),
    )
    .digest("hex");
}
