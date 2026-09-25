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

/** Keeps a recent, server-valid sample through brief GPS accuracy jitter at the geofence edge. */
internal fun actionableGps(current: DriverGps?, lastReady: DriverGps?, lastReadyPoint: ExecutionPoint?,
    target: ExecutionPoint?, policy: ArrivalPolicy, elapsed: Long): DriverGps? {
    if (current?.mock == true) return null
    if (arrivalEligibility(current, target, policy, elapsed) == ArrivalEligibility.READY) return current
    if (target == null || target != lastReadyPoint || lastReady == null) return null
    val age = elapsed - lastReady.elapsedMillis
    if (age !in 0..minOf(3_000L, policy.maxSampleAgeSeconds * 1_000L)) return null
    return lastReady.takeIf { arrivalEligibility(it, target, policy, elapsed) == ArrivalEligibility.READY }
}

// Server clock + monotonic delta; changing the phone's wall clock cannot make an old sample fresh.
internal fun sampleCapturedAt(serverTime: Instant, receivedElapsed: Long, sampleElapsed: Long): Instant =
    serverTime.plusMillis(sampleElapsed - receivedElapsed)
