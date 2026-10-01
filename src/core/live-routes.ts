import type { Pool } from "pg";
import { assertActiveActor, transaction } from "./database";
import type { DriverOrderStatus } from "./driver-service-policy";
import { stopProgress, trackingPolicy } from "./live-tracking-policy";
import type { PublicOptimizedRoute } from "./routing-contract";
import type { LiveEta } from "./live-eta";
import { liveWarehouseDestination, type LiveWarehouseDestination } from "./live-warehouse-policy";
import { getRoutingSettings } from "./routing-settings";

export type LiveStop = { id: string; position: number; customer: string; address: string;
  latitude: number | null; longitude: number | null; arrivedAt: string | null;
  orders: { id: string; name: string; status: DriverOrderStatus }[]; progress: ReturnType<typeof stopProgress> };
export type LiveRoute = { id: string; planId: string; label: string; date: string;
  driverId: string; driver: string; vehicleId: string; vehicle: string; plate: string;
  startedAt: string; completedAt?: string | null; targetStopId: string | null; arrivedStopId: string | null;
  eta?: LiveEta | null;
  warehouseDestination?: LiveWarehouseDestination | null;
  location: { latitude: number; longitude: number; accuracy: number; observedAt: string; receivedAt: string; stopped: boolean } | null;
  polylines: string[]; corrected: boolean; stops: LiveStop[];
  progress: { orders: number; delivered: number; rescheduled: number; incidentOrders: number; remainingStops: number; completedStops: number; totalStops: number } };
export type LiveRoutesReport = { serverTime: string; policy: typeof trackingPolicy; routes: LiveRoute[] };

export async function readLiveRoutes(pool: Pool, actor: string): Promise<LiveRoutesReport> {
  return transaction(pool, async sql => {
    await sql.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await assertActiveActor(sql, actor);
    const executions = (await sql.query(`SELECT e.*,e.service_date::text AS date,c.completed_at,
      pub.snapshot->'route' AS published_route,pub.snapshot->'orders' AS published_orders,
      t.target_stop_id,t.latitude,t.longitude,t.accuracy_meters,t.observed_at,t.received_at,t.eta,t.warehouse_depot_version,
      (c.completed_at IS NOT NULL OR t.stopped OR dev.revoked_at IS NOT NULL OR NOT coalesce(access.enabled,false)
        OR NOT EXISTS(SELECT 1 FROM route_driver_mobile_sessions session WHERE session.device_id=t.device_id
          AND session.revoked_at IS NULL AND session.expires_at>now())) AS tracking_stopped
      FROM route_driver_executions e
      JOIN route_plan_publications pub ON pub.plan_id=e.plan_id AND pub.vehicle_id=e.vehicle_id
        AND pub.revision=e.publication_revision AND pub.started_driver_id=e.driver_id AND pub.revoked_at IS NULL
      JOIN route_plan_vehicles pv ON pv.plan_id=e.plan_id AND pv.vehicle_id=e.vehicle_id AND pv.driver_id=e.driver_id
      JOIN route_drivers d ON d.id=e.driver_id AND d.active
      LEFT JOIN route_live_tracking t ON t.execution_id=e.id
      LEFT JOIN route_driver_execution_completions c ON c.execution_id=e.id
      LEFT JOIN route_driver_mobile_devices dev ON dev.id=t.device_id
      LEFT JOIN route_driver_mobile_access access ON access.driver_id=e.driver_id
      WHERE NOT EXISTS(SELECT 1 FROM route_driver_work_completions w WHERE w.execution_id=e.id)
      ORDER BY e.service_date DESC,e.driver_name,e.id`)).rows;
    const ids = executions.map(e => e.id);
    const settings = await getRoutingSettings(sql);
    const stops = (await sql.query(`SELECT s.*,coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',o.shipment_id,'name',s.order_names[array_position(s.shipment_ids,o.shipment_id)],'status',o.status)
      ORDER BY array_position(s.shipment_ids,o.shipment_id)) FROM route_driver_execution_orders o
      WHERE o.execution_id=s.execution_id AND o.stop_id=s.id),'[]'::jsonb) AS orders
      FROM route_driver_execution_stops s WHERE s.execution_id=ANY($1::uuid[]) ORDER BY s.position`, [ids])).rows;
    return { serverTime: new Date().toISOString(), policy: trackingPolicy, routes: executions.map(e => {
      const rows = stops.filter(s => s.execution_id === e.id);
      const corrected = rows.some(s => s.corrected_at !== null);
      const mapped: LiveStop[] = rows.map(s => ({ id: s.id, position: s.position, customer: s.customer_name,
        address: s.address, latitude: s.latitude, longitude: s.longitude, arrivedAt: s.arrived_at?.toISOString() ?? null,
        orders: s.orders, progress: stopProgress((s.orders as LiveStop["orders"]).map(o => o.status)) }));
      const route = e.published_route as PublicOptimizedRoute | null;
      const warehouse = liveWarehouseDestination({ version: e.warehouse_depot_version ?? null, target: e.target_stop_id,
        completed: e.completed_at != null, stopped: Boolean(e.tracking_stopped), receivedAt: e.received_at ?? null }, settings,
        e.published_orders.map((order: { id: string }) => order.id), mapped.flatMap(s => s.orders.map(o => ({ shipment_id: o.id, status: o.status }))));
      return { id: e.id, planId: e.plan_id, label: e.plan_label, date: e.date, driverId: e.driver_id, driver: e.driver_name,
        vehicleId: e.vehicle_id, vehicle: e.vehicle_name, plate: e.vehicle_plate, startedAt: e.started_at.toISOString(),
        completedAt: e.completed_at?.toISOString() ?? null,
        targetStopId: mapped.some(s => s.id === e.target_stop_id && s.progress.visible) ? e.target_stop_id : null,
        arrivedStopId: mapped.find(s => s.arrivedAt !== null && s.progress.visible)?.id ?? null,
        warehouseDestination: warehouse,
        eta: e.eta?.depotVersion != null && !warehouse ? null : e.eta ?? null,
        location: e.observed_at ? { latitude: e.latitude, longitude: e.longitude, accuracy: e.accuracy_meters,
          observedAt: e.observed_at.toISOString(), receivedAt: e.received_at.toISOString(), stopped: Boolean(e.tracking_stopped) } : null,
        corrected, polylines: corrected ? [] : route?.segmentPolylines?.length ? route.segmentPolylines : route?.encodedPolyline ? [route.encodedPolyline] : [],
        stops: mapped, progress: { orders: mapped.reduce((n,s) => n+s.progress.total,0),
          delivered: mapped.reduce((n,s) => n+s.progress.delivered,0), rescheduled: mapped.reduce((n,s) => n+s.progress.rescheduled,0),
          incidentOrders: mapped.reduce((n,s) => n+s.progress.pending,0), remainingStops: mapped.filter(s => s.progress.visible).length,
          completedStops: mapped.filter(s => s.progress.status === "delivered").length, totalStops: mapped.length } };
    }) };
  });
}
