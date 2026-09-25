package com.five.anarutas.driver

internal enum class GuidanceResultDecision { IGNORE, DESTINATION_CHANGED, CURRENT }

/** A late SDK response never starts guidance to a replaced or revoked destination. */
internal fun guidanceResultDecision(requestGeneration: Int, currentGeneration: Int,
    requestedDestination: String, currentDestination: String?, retired: Boolean, destroyed: Boolean): GuidanceResultDecision {
    if (destroyed || retired || requestGeneration != currentGeneration) return GuidanceResultDecision.IGNORE
    if (requestedDestination != currentDestination) return GuidanceResultDecision.DESTINATION_CHANGED
    return GuidanceResultDecision.CURRENT
}
