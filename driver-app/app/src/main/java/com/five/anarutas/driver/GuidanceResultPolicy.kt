package com.five.anarutas.driver

internal enum class GuidanceResultDecision { IGNORE, DESTINATION_CHANGED, CURRENT }

internal data class NavigationActionState(
    val verified: Boolean,
    val pending: Boolean,
    val busy: Boolean,
    val retired: Boolean,
    val editing: Boolean,
    val navigating: Boolean,
    val noticeRequired: Boolean,
    val navigatorReady: Boolean,
    val destination: ExecutionPoint?,
    val alreadyGuidingToDestination: Boolean,
)

/** Reading a stop never changes guidance; only an explicit eligible action may do so. */
internal fun navigationActionAllowed(state: NavigationActionState): Boolean =
    state.verified && !state.pending && !state.busy && !state.retired && !state.editing &&
        !state.navigating && !state.noticeRequired && state.navigatorReady &&
        state.destination != null && !state.alreadyGuidingToDestination

/** A late SDK response never starts guidance to a replaced or revoked destination. */
internal fun guidanceResultDecision(requestGeneration: Int, currentGeneration: Int,
    requestedDestination: String, currentDestination: String?, retired: Boolean, destroyed: Boolean): GuidanceResultDecision {
    if (destroyed || retired || requestGeneration != currentGeneration) return GuidanceResultDecision.IGNORE
    if (requestedDestination != currentDestination) return GuidanceResultDecision.DESTINATION_CHANGED
    return GuidanceResultDecision.CURRENT
}
