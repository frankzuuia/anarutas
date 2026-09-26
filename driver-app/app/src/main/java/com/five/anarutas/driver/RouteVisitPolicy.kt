package com.five.anarutas.driver

/** A consulted stop is not a visit exit. Exit only when the driver chooses a new destination. */
internal fun activeVisitToExit(stops: List<ExecutionStop>, destinationId: String): ExecutionStop? =
    stops.firstOrNull { it.id != destinationId && it.arrivedAt != null }
