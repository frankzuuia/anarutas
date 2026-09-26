package com.five.anarutas.driver

import org.junit.Assert.*
import org.junit.Test

class GpsRecoveryPolicyTest {
    private val policy = ArrivalPolicy(100, 50, 30, 1)
    private val gps = DriverGps(ExecutionPoint(20.64, -103.4), 5.0, 100_000, false)
    private fun decision(sample: DriverGps? = null, now: Long = 100_000, active: Boolean = true,
        enabled: Boolean = true, started: Long? = null, attempt: Long? = null, settings: ArrivalPolicy? = policy) =
        gpsRecoveryDecision(sample, settings, now, active, enabled, started, attempt)

    @Test fun missingAndStaleFixRequestFreshReadAutomatically() {
        assertEquals(GpsRecoveryDecision.REQUEST, decision())
        assertEquals(GpsRecoveryDecision.REQUEST, decision(gps, 130_001))
        assertEquals(GpsRecoveryDecision.NONE, decision(gps, 130_000))
        assertEquals(GpsRecoveryDecision.REQUEST, decision(gps, 99_999))
        assertEquals(GpsRecoveryDecision.REQUEST, decision(gps.copy(mock = true)))
        assertEquals(GpsRecoveryDecision.REQUEST, decision(gps.copy(accuracy = 51.0)))
    }
    @Test fun freshFixDoesNotPollAndCancelsOutstandingRequests() {
        assertEquals(GpsRecoveryDecision.NONE, decision(gps))
        assertEquals(GpsRecoveryDecision.CANCEL, decision(gps, started = 90_000))
    }
    @Test fun noBackgroundOrPermissionlessOrDisabledProviderReads() {
        for (pending in listOf(null, 90_000L)) {
            val expected = if (pending == null) GpsRecoveryDecision.NONE else GpsRecoveryDecision.CANCEL
            assertEquals(expected, decision(active = false, started = pending))
            assertEquals(expected, decision(enabled = false, started = pending))
            assertEquals(expected, decision(settings = null, started = pending))
        }
    }
    @Test fun timeoutCancelsOnlyAtActualBoundaryWithoutParallelRequests() {
        assertEquals(GpsRecoveryDecision.NONE, decision(started = 80_001))
        assertEquals(GpsRecoveryDecision.CANCEL, decision(started = 80_000))
        assertEquals(GpsRecoveryDecision.CANCEL, decision(started = 79_999))
    }
    @Test fun backoffBoundsSensorCostAndResumesAtBoundary() {
        assertEquals(GpsRecoveryDecision.NONE, decision(attempt = 90_001))
        assertEquals(GpsRecoveryDecision.REQUEST, decision(attempt = 90_000))
        assertEquals(GpsRecoveryDecision.NONE, decision(settings = policy.copy(maxSampleAgeSeconds = 0), attempt = 99_001))
        assertEquals(GpsRecoveryDecision.REQUEST, decision(settings = policy.copy(maxSampleAgeSeconds = 0), attempt = 99_000))
        assertEquals(GpsRecoveryDecision.NONE, decision(settings = policy.copy(maxSampleAgeSeconds = 3), attempt = 98_501))
        assertEquals(GpsRecoveryDecision.REQUEST, decision(settings = policy.copy(maxSampleAgeSeconds = 3), attempt = 98_500))
    }
    @Test fun delayedCallbacksCannotUpdateStoppedOrNewGenerationScreen() {
        assertTrue(acceptsGpsRecoveryCallback(2, 2, true))
        assertFalse(acceptsGpsRecoveryCallback(1, 2, true))
        assertFalse(acceptsGpsRecoveryCallback(3, 2, true))
        assertFalse(acceptsGpsRecoveryCallback(2, 2, false))
    }
    @Test fun recoveryNeverChangesAgeAccuracyOrArrivalRadius() {
        decision(gps, 130_001)
        assertEquals(ArrivalEligibility.STALE, arrivalEligibility(gps, gps.point, policy, 130_001))
        assertEquals(ArrivalEligibility.OUTSIDE, arrivalEligibility(gps, ExecutionPoint(21.0, -103.4), policy, 100_000))
        assertEquals(100_000L, gps.elapsedMillis)
        assertEquals(5.0, gps.accuracy, 0.0)
    }
}
