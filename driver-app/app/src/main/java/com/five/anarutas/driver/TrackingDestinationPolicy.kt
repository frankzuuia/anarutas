package com.five.anarutas.driver

/** One immutable heartbeat destination; the auxiliary warehouse never becomes a customer stop. */
internal data class TrackingDestination(val stopId: String? = null, val depotVersion: Int? = null) {
    val etaId get() = if (depotVersion != null) "warehouse" else stopId
}

internal fun trackingNavigationDestination(warehouse: WarehouseDestination?, customerStopId: String?,
    navigating: Boolean, guiding: Boolean, requestedKey: String?, activeKey: String?): TrackingDestination {
    if (warehouse != null && ((navigating && requestedKey == warehouse.key) ||
        (guiding && activeKey == warehouse.key))) return TrackingDestination(depotVersion = warehouse.departure.version)
    return TrackingDestination(stopId = customerStopId)
}

internal fun trackingIntentDestination(stopId: String?, depotVersion: Int): TrackingDestination =
    if (stopId == null && depotVersion > 0) TrackingDestination(depotVersion = depotVersion) else TrackingDestination(stopId = stopId)

internal fun trackingEffectiveDestination(target: TrackingDestination, rejectedDepotVersion: Int?): TrackingDestination =
    if (target.depotVersion != null && target.depotVersion == rejectedDepotVersion) TrackingDestination() else target

internal fun trackingRejectsWarehouse(status: Int, code: String) = status == 409 && code in
    listOf("ROUTING_ORIGIN_REQUIRED", "ROUTING_ORIGIN_CHANGED", "ROUTE_HAS_PENDING_ORDERS")

internal fun trackingObservedDestination(target: TrackingDestination, eta: NavigationEta?, guiding: Boolean): TrackingDestination {
    if (target.depotVersion != null && (eta == null || eta.targetStopId != target.etaId ||
        (eta.state != "calculating" && !guiding))) return TrackingDestination()
    return target
}
