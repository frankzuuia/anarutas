package com.five.anarutas.driver

internal enum class StopCompletion { DELIVERED, CUSTOMER_CLOSED }
internal data class StopContinuation(val commandId: String, val stopId: String, val completion: StopCompletion)

/** Called only for a server-confirmed command after the execution is re-read. */
internal fun confirmedStopContinuation(commandId: String, kind: String, serviceKind: String?, stop: ExecutionStop?): StopContinuation? {
    if (stop == null) return null
    val completion = when {
        kind == "closed" && stop.hasPendingRetry() -> StopCompletion.CUSTOMER_CLOSED
        kind == "service" && serviceKind == "deliver" && stop.isServiceFinished() -> StopCompletion.DELIVERED
        else -> return null
    }
    return StopContinuation(commandId, stop.id, completion)
}

/** Published order, wrapping to earlier unfinished stops, never back to this stop. */
internal fun nextPendingStop(stops: List<ExecutionStop>, completedStopId: String): ExecutionStop? {
    val ordered = stops.sortedBy { it.position }
    val current = ordered.indexOfFirst { it.id == completedStopId }
    if (current < 0) return null
    return (ordered.drop(current + 1) + ordered.take(current)).firstOrNull {
        it.isVisibleOnMap() && it.orderStates.any { order -> canDeliverOrder(order.status) }
    }
}

internal fun showPublishedPreview(guiding: Boolean, calculating: Boolean, sdkGuiding: Boolean, corrected: Boolean): Boolean =
    !guiding && !calculating && !sdkGuiding && !corrected
