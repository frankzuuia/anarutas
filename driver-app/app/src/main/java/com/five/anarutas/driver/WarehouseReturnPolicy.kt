package com.five.anarutas.driver

/** Auxiliary SDK destination; etaId is local only and must never become a server stopId. */
internal data class WarehouseDestination(val executionId: String, val departure: RouteDeparture) {
    val point get() = ExecutionPoint(departure.latitude, departure.longitude)
    val etaId get() = "warehouse"
    val key get() = "$executionId:$etaId:${departure.version}:${departure.latitude}:${departure.longitude}"
}

/** Absence of a navigable next marker is not evidence of a completed route. */
internal fun warehouseReturnDestination(route: AssignedPlan?, execution: DriverExecution?): WarehouseDestination? {
    if (route == null || execution == null || route.id != execution.planId ||
        route.publicationRevision < 1 || route.publicationRevision != execution.publicationRevision || route.startedAt.isNullOrBlank() ||
        route.completedAt != null || execution.completedAt != null) return null
    val departure = route.departure ?: return null
    if (departure.address.isBlank() || departure.version < 1 ||
        !departure.latitude.isFinite() || departure.latitude !in -90.0..90.0 ||
        !departure.longitude.isFinite() || departure.longitude !in -180.0..180.0) return null
    val expected = route.orders.map { it.id }
    if (expected.isEmpty() || expected.any { it.isBlank() } || expected.toSet().size != expected.size || execution.stops.isEmpty()) return null
    val shipmentIds = execution.stops.flatMap { it.shipmentIds }
    if (shipmentIds.size != expected.size || shipmentIds.toSet() != expected.toSet()) return null
    for (stop in execution.stops) {
        val states = stop.orderStates
        if (stop.shipmentIds.isEmpty() || states.size != stop.shipmentIds.size ||
            states.map { it.shipmentId }.toSet() != stop.shipmentIds.toSet() ||
            states.any { it.status !in listOf(OrderServiceStatus.DELIVERED, OrderServiceStatus.RESCHEDULED) ||
                (it.status == OrderServiceStatus.DELIVERED && it.paymentRequired && !it.paymentConfirmed) }) return null
    }
    return WarehouseDestination(execution.id, departure)
}
