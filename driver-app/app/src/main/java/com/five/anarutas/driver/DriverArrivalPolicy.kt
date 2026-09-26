package com.five.anarutas.driver

import java.time.Instant
import kotlin.math.*

internal data class ExecutionPoint(val latitude: Double, val longitude: Double)
internal data class ArrivalPolicy(val radiusMeters: Int, val maxAccuracyMeters: Int, val maxSampleAgeSeconds: Int, val version: Int)
internal data class DriverGps(val point: ExecutionPoint, val accuracy: Double, val elapsedMillis: Long, val mock: Boolean)
internal enum class ArrivalEligibility { READY, NO_GPS, STALE, IMPRECISE, UNTRUSTED, OUTSIDE, MISSING_POINT }

/** Pure policy, shared by arrival and repoint; never expands the radius with GPS error. */
internal fun pointDistance(a: ExecutionPoint, b: ExecutionPoint): Double {
    val rad = Math.PI / 180
    val h = sin((b.latitude - a.latitude) * rad / 2).pow(2) + cos(a.latitude * rad) *
        cos(b.latitude * rad) * sin((b.longitude - a.longitude) * rad / 2).pow(2)
    return 6_371_008.8 * 2 * atan2(sqrt(h.coerceIn(0.0, 1.0)), sqrt((1 - h).coerceAtLeast(0.0)))
}
internal fun arrivalEligibility(gps: DriverGps?, point: ExecutionPoint?, policy: ArrivalPolicy, elapsed: Long): ArrivalEligibility {
    if (point == null) return ArrivalEligibility.MISSING_POINT
    if (gps == null) return ArrivalEligibility.NO_GPS
    if (gps.mock) return ArrivalEligibility.UNTRUSTED
    val age = elapsed - gps.elapsedMillis
    if (age < 0 || age > policy.maxSampleAgeSeconds * 1000L) return ArrivalEligibility.STALE
    if (!gps.accuracy.isFinite() || gps.accuracy < 0 || gps.accuracy > policy.maxAccuracyMeters) return ArrivalEligibility.IMPRECISE
    if (!gps.point.latitude.isFinite() || !gps.point.longitude.isFinite() ||
        gps.point.latitude !in -90.0..90.0 || gps.point.longitude !in -180.0..180.0 ||
        !point.latitude.isFinite() || !point.longitude.isFinite() || point.latitude !in -90.0..90.0 || point.longitude !in -180.0..180.0)
        return ArrivalEligibility.MISSING_POINT
    return if (pointDistance(gps.point, point) + gps.accuracy <= policy.radiusMeters) ArrivalEligibility.READY else ArrivalEligibility.OUTSIDE
}

/** The old customer pin is irrelevant: a fresh trusted fix can propose the driver's actual position. */
internal fun currentLocationRepointCandidate(gps: DriverGps?, policy: ArrivalPolicy, elapsed: Long): ExecutionPoint? =
    gps?.point?.takeIf { arrivalEligibility(gps, it, policy, elapsed) == ArrivalEligibility.READY }

/** Reuses only a still-server-valid sample through a newer imprecise location update. */
internal fun actionableGps(current: DriverGps?, lastReady: DriverGps?, lastReadyPoint: ExecutionPoint?,
    target: ExecutionPoint?, policy: ArrivalPolicy, elapsed: Long): DriverGps? {
    val currentEligibility = arrivalEligibility(current, target, policy, elapsed)
    if (currentEligibility == ArrivalEligibility.READY) return current
    // A trustworthy newer fix outside the radius revokes an earlier arrival candidate.
    // Missing, stale and simulated fixes must never unlock an action via the cache.
    if (currentEligibility != ArrivalEligibility.IMPRECISE || target == null ||
        target != lastReadyPoint || lastReady == null || current == null ||
        lastReady.elapsedMillis > current.elapsedMillis) return null
    return lastReady.takeIf { arrivalEligibility(it, target, policy, elapsed) == ArrivalEligibility.READY }
}

// Server clock + monotonic delta; changing the phone's wall clock cannot make an old sample fresh.
internal fun sampleCapturedAt(serverTime: Instant, receivedElapsed: Long, sampleElapsed: Long): Instant =
    serverTime.plusMillis(sampleElapsed - receivedElapsed)

/** Android providers may deliver callbacks out of timestamp order. Never regress to an older fix. */
internal fun isNewLocationSample(current: DriverGps?, incoming: DriverGps): Boolean =
    current == null || incoming.elapsedMillis >= current.elapsedMillis

internal data class ArrivalEvaluation(val gps: DriverGps?, val eligibility: ArrivalEligibility)

/** Read the live monotonic clock once per evaluation, never the last UI timer timestamp. */
internal fun evaluateArrivalNow(current: DriverGps?, lastReady: DriverGps?, lastReadyPoint: ExecutionPoint?,
    target: ExecutionPoint?, policy: ArrivalPolicy, elapsedRealtime: () -> Long): ArrivalEvaluation {
    val elapsed = elapsedRealtime()
    val usable = actionableGps(current, lastReady, lastReadyPoint, target, policy, elapsed)
    return ArrivalEvaluation(usable, if (usable != null) ArrivalEligibility.READY else
        arrivalEligibility(current, target, policy, elapsed))
}
