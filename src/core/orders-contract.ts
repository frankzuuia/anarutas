import type { Plan } from "./plans";
import type { Vehicle } from "./fleet-contract";
import type {
  CustomerPriority,
  EffectiveDeliveryWindow,
  FulfillmentMode,
} from "./customers-contract";

export type ShipmentLine = {
  moveId: number;
  productId: number;
  name: string;
  quantity: number;
  unit: string;
  pickerNote?: string;
};
export type SourceShipment = {
  pickingId: number;
  pickingName: string;
  orderId: number;
  orderName: string;
  partnerId: number;
  customerName: string;
  address: string;
  validatedAt: string | null;
  odooPickingState?: string;
  fulfillmentStatus?: "validated" | "pending_validation";
  scheduledAt?: string | null;
  sourceUpdatedAt?: string | null;
  promisedAt: string | null;
  backorderId: number | null;
  lines: ShipmentLine[];
};
export type Shipment = SourceShipment & {
  id: string;
  vehicle_id: string | null;
  position: number;
  window_start: string | null;
  window_end: string | null;
  high_priority: boolean | null;
  priority: CustomerPriority;
  deliveryWindows: EffectiveDeliveryWindow[];
  deliveryNote: string;
  phone: string | null;
  fulfillmentMode: FulfillmentMode;
  mapUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  locationStatus: "pending" | "confirmed" | "driver_confirmed";
  customerArchived: boolean;
};
export type OrderBoard = {
  plan: Plan;
  vehicles: Vehicle[];
  shipments: Shipment[];
};
export type ImportPage = {
  fingerprint: string;
  shipments: SourceShipment[];
  nextCursor: number;
  ceiling: number;
  hasMore: boolean;
  inspected: number;
  excluded: number;
};
export type ImportResult = {
  inserted: number;
  existing: number;
  changed: number;
  inspected: number;
  excluded: number;
  nextCursor: number;
  ceiling: number;
  hasMore: boolean;
};
