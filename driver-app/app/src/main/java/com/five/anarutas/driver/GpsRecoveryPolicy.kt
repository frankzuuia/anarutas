package com.five.anarutas.driver

internal enum class GpsRecoveryDecision { NONE, REQUEST, CANCEL }
internal const val GPS_REQUEST_TIMEOUT_MILLIS = 20_000L

/** Recovery schedules sensor reads, never alters the validity/age of a fix. */
internal fun gpsRecoveryDecision(gps: DriverGps?, policy: ArrivalPolicy?, now: Long,
    active: Boolean, providerEnabled: Boolean, requestStarted: Long?, lastAttempt: Long?): GpsRecoveryDecision {
    if (!active || !providerEnabled || policy == null)
        return if (requestStarted != null) GpsRecoveryDecision.CANCEL else GpsRecoveryDecision.NONE
    val fresh = currentLocationRepointCandidate(gps, policy, now) != null
    if (fresh) return if (requestStarted != null) GpsRecoveryDecision.CANCEL else GpsRecoveryDecision.NONE
    if (requestStarted != null) return if (now - requestStarted >= GPS_REQUEST_TIMEOUT_MILLIS)
        GpsRecoveryDecision.CANCEL else GpsRecoveryDecision.NONE
    val backoff = (policy.maxSampleAgeSeconds * 500L).coerceIn(1_000L, 10_000L)
    if (lastAttempt != null && now - lastAttempt < backoff) return GpsRecoveryDecision.NONE
    return GpsRecoveryDecision.REQUEST
}

internal fun acceptsGpsRecoveryCallback(requestGeneration: Int, generation: Int, active: Boolean) =
    active && requestGeneration == generation
