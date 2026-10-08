import { AppError } from "./errors";
import type { SourceShipment } from "./orders-contract";
import type { ArchivedCustomerOrder } from "./order-candidates-contract";

/** State belongs to the exact delivery contact already resolved by the connector. */
export function partitionArchivedOrders<
  T extends SourceShipment & { odooPartnerActive: unknown },
>(
  rows: T[],
): {
  shipments: Omit<T, "odooPartnerActive">[];
  archivedCustomerOrders: ArchivedCustomerOrder[];
} {
  const shipments: Omit<T, "odooPartnerActive">[] = [];
  const archivedCustomerOrders: ArchivedCustomerOrder[] = [];
  for (const row of rows) {
    const { odooPartnerActive, ...shipment } = row;
    if (typeof odooPartnerActive !== "boolean")
      throw new AppError("ODOO_INVALID_RESPONSE", 502);
    if (odooPartnerActive) {
      shipments.push(shipment);
    } else {
      const {
        pickingId,
        pickingName,
        orderId,
        orderName,
        partnerId,
        customerName,
      } = shipment;
      archivedCustomerOrders.push({
        pickingId,
        pickingName,
        orderId,
        orderName,
        partnerId,
        customerName,
      });
    }
  }
  return { shipments, archivedCustomerOrders };
}
