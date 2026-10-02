import { routeStartPendingOrders } from "./route-start-validation";

type PublicationVehicle = { id: string; name: string };
type PublicationOrder = {
  id: string;
  orderName: string;
  vehicle_id: string | null;
  fulfillmentStatus?: string | null;
};

/** Supply only the selected, not-started vehicles; never unassigned/foreign orders. */
export function routePublicationPendingVehicles(
  vehicles: PublicationVehicle[],
  orders: PublicationOrder[],
) {
  return vehicles.flatMap((vehicle) => {
    const pendingValidationOrders = routeStartPendingOrders(
      orders.filter((order) => order.vehicle_id === vehicle.id),
    );
    return pendingValidationOrders.length
      ? [
          {
            vehicleId: vehicle.id,
            vehicleName: vehicle.name,
            pendingValidationOrders,
          },
        ]
      : [];
  });
}
