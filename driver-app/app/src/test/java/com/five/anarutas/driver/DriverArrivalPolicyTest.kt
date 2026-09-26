package com.five.anarutas.driver

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class DriverArrivalPolicyTest {
    private val point = ExecutionPoint(20.64, -103.4)
    private val gps = DriverGps(point, 5.0, 100_000, false)
    private val policy = ArrivalPolicy(100, 50, 30, 1)
    @Test fun preciseLiveSampleAndBoundaryAreAccepted() {
        assertEquals(ArrivalEligibility.READY, arrivalEligibility(gps, point, policy, 100_000))
        assertEquals(ArrivalEligibility.READY, arrivalEligibility(gps, point, policy, 130_000))
        assertEquals(ArrivalEligibility.READY, arrivalEligibility(gps.copy(accuracy = 50.0), point, policy, 100_000))
        assertEquals(ArrivalEligibility.READY, arrivalEligibility(gps.copy(accuracy = 100.0), point, policy.copy(maxAccuracyMeters = 100), 100_000))
    }
    @Test fun oldFutureSimulatedAndMissingGpsFailClosed() {
        assertEquals(ArrivalEligibility.NO_GPS, arrivalEligibility(null, point, policy, 100_000))
        assertEquals(ArrivalEligibility.STALE, arrivalEligibility(gps, point, policy, 130_001))
        assertEquals(ArrivalEligibility.STALE, arrivalEligibility(gps, point, policy, 99_999))
        assertEquals(ArrivalEligibility.UNTRUSTED, arrivalEligibility(gps.copy(mock = true), point, policy, 100_000))
        assertEquals(ArrivalEligibility.MISSING_POINT, arrivalEligibility(gps, null, policy, 100_000))
    }
    @Test fun errorBudgetMustFitInsideRadiusAndAccuracyLimit() {
        val nearEdge = ExecutionPoint(20.6408, -103.4)
        assertEquals(88.95, pointDistance(point, nearEdge), .1)
        assertEquals(ArrivalEligibility.READY, arrivalEligibility(gps, nearEdge, policy, 100_000))
        assertEquals(ArrivalEligibility.OUTSIDE, arrivalEligibility(gps.copy(accuracy = 20.0), nearEdge, policy, 100_000))
        assertEquals(ArrivalEligibility.OUTSIDE, arrivalEligibility(gps, ExecutionPoint(21.0, -103.4), policy, 100_000))
        for (accuracy in listOf(-1.0, 50.01, Double.NaN, Double.POSITIVE_INFINITY)) {
            assertEquals(ArrivalEligibility.IMPRECISE, arrivalEligibility(gps.copy(accuracy = accuracy), point, policy, 100_000))
        }
    }
    @Test fun repointUsesNewPointRatherThanOldIncorrectAddress() {
        val wrong = ExecutionPoint(21.0, -103.4)
        assertEquals(ArrivalEligibility.OUTSIDE, arrivalEligibility(gps, wrong, policy, 100_000))
        assertEquals(ArrivalEligibility.READY, arrivalEligibility(gps, point, policy, 100_000))
        assertEquals(0.0, pointDistance(point, point), 0.0)
        assertEquals(111195.08, pointDistance(ExecutionPoint(0.0, 0.0), ExecutionPoint(0.0, 1.0)), .02)
        assertEquals(20_015_114.44, pointDistance(ExecutionPoint(0.0, 0.0), ExecutionPoint(0.0, 180.0)), .02)
        assertEquals(78_626.296, pointDistance(ExecutionPoint(45.0, 0.0), ExecutionPoint(45.0, 1.0)), .01)
    }
    @Test fun currentLocationCanReplaceAnOldPinAcrossTownButOnlyWithTrustedGps() {
        val oldWrongPin = ExecutionPoint(21.0, -103.4)
        assertEquals(ArrivalEligibility.OUTSIDE, arrivalEligibility(gps, oldWrongPin, policy, 100_000))
        assertEquals(point, currentLocationRepointCandidate(gps, policy, 100_000))
        assertEquals(ArrivalEligibility.READY, arrivalEligibility(gps, point, policy, 100_000))
        assertNull(currentLocationRepointCandidate(null, policy, 100_000))
        assertNull(currentLocationRepointCandidate(gps.copy(mock = true), policy, 100_000))
        assertNull(currentLocationRepointCandidate(gps.copy(accuracy = 70.0), policy, 100_000))
        assertNull(currentLocationRepointCandidate(gps, policy, 130_001))
        assertNull(currentLocationRepointCandidate(gps.copy(point = ExecutionPoint(91.0, -103.4)), policy, 100_000))
        val manuallyPlacedFarAway = ExecutionPoint(20.7, -103.4)
        assertEquals(ArrivalEligibility.OUTSIDE, arrivalEligibility(gps, manuallyPlacedFarAway, policy, 100_000))
    }
    @Test fun invalidCoordinatesCannotEnableArrival() {
        for (bad in listOf(ExecutionPoint(91.0, 0.0), ExecutionPoint(-91.0, 0.0), ExecutionPoint(0.0, 181.0),
            ExecutionPoint(0.0, -181.0), ExecutionPoint(Double.NaN, 0.0), ExecutionPoint(0.0, Double.NaN),
            ExecutionPoint(Double.POSITIVE_INFINITY, 0.0), ExecutionPoint(0.0, Double.POSITIVE_INFINITY))) {
            assertEquals(ArrivalEligibility.MISSING_POINT, arrivalEligibility(gps, bad, policy, 100_000))
            assertEquals(ArrivalEligibility.MISSING_POINT, arrivalEligibility(gps.copy(point = bad), point, policy, 100_000))
        }
    }
    @Test fun serverAnchorUsesSampleMonotonicAgeWithoutPhoneWallClock() {
        val server = Instant.parse("2026-09-24T17:00:00Z")
        assertEquals(server.minusSeconds(5), sampleCapturedAt(server, 100_000, 95_000))
        assertEquals(server.plusSeconds(20), sampleCapturedAt(server, 100_000, 120_000))
        assertEquals(server, sampleCapturedAt(server, 100_000, 100_000))
    }
    @Test fun accuracyJitterReusesOnlyTheSameServerFreshValidSample() {
        val worse = gps.copy(accuracy = 70.0, elapsedMillis = 101_000)
        assertEquals(gps, actionableGps(worse, gps, point, point, policy, 101_000))
        assertEquals(gps, actionableGps(worse, gps, point, point, policy, 120_000))
        assertEquals(gps, actionableGps(worse, gps, point, point, policy, 130_000))
        assertNull(actionableGps(worse, gps, point, point, policy, 130_001))
        assertNull(actionableGps(worse, gps, point, ExecutionPoint(21.0, -103.4), policy, 101_000))
        assertNull(actionableGps(worse, gps, point, ExecutionPoint(20.6401, -103.4), policy, 101_000))
        assertNull(actionableGps(worse, gps.copy(mock = true), point, point, policy, 101_000))
        assertNull(actionableGps(gps.copy(mock = true), gps, point, point, policy, 101_000))
        assertNull(actionableGps(null, null, null, point, policy, 101_000))
        assertNull(actionableGps(null, gps, point, point, policy, 101_000))
        assertNull(actionableGps(worse, gps.copy(elapsedMillis = 101_001), point, point, policy, 101_001))
        assertEquals(gps, actionableGps(gps, null, null, point, policy, 100_000))
        assertEquals(gps, actionableGps(worse.copy(elapsedMillis = 100_500), gps, point, point, policy.copy(maxSampleAgeSeconds = 1), 100_500))
        assertNull(actionableGps(worse, gps, point, point, policy.copy(maxSampleAgeSeconds = 1), 101_500))
    }
    @Test fun newerTrustedOutsideFixRevokesPreviousArrivalCandidate() {
        val outside = gps.copy(point = ExecutionPoint(21.0, -103.4), elapsedMillis = 101_000)
        assertNull(actionableGps(outside, gps, point, point, policy, 101_000))
        assertNull(actionableGps(gps.copy(mock = true, elapsedMillis = 101_000), gps, point, point, policy, 101_000))
    }
    @Test fun delayedNetworkCallbackCannotReplaceNewerGpsFix() {
        assertTrue(isNewLocationSample(null, gps))
        assertTrue(isNewLocationSample(gps, gps.copy(elapsedMillis = 100_000)))
        assertTrue(isNewLocationSample(gps, gps.copy(elapsedMillis = 100_001)))
        assertFalse(isNewLocationSample(gps, gps.copy(elapsedMillis = 99_999)))
    }
    @Test fun freshCallbacksBetweenUiTicksNeverBecomeArtificiallyFutureDated() {
        // Reproduce the old defect: the last timer timestamp predates the new location.
        val lastUiTick = 100_000L
        val firstFix = gps.copy(elapsedMillis = 100_350)
        assertEquals(ArrivalEligibility.STALE, arrivalEligibility(firstFix, point, policy, lastUiTick))
        for (sampleTime in listOf(100_350L, 100_850L, 101_350L, 101_850L)) {
            val fix = gps.copy(elapsedMillis = sampleTime)
            val result = evaluateArrivalNow(fix, null, null, point, policy) { sampleTime + 10 }
            assertEquals(fix, result.gps)
            assertEquals(ArrivalEligibility.READY, result.eligibility)
        }
    }
    @Test fun evaluationReadsClockOnceAndExpiresWithoutAnyNewLocation() {
        var now = 130_000L
        var reads = 0
        val clock = { reads++; now++ }
        val boundary = evaluateArrivalNow(gps, null, null, point, policy, clock)
        assertEquals(1, reads)
        assertEquals(ArrivalEligibility.READY, boundary.eligibility)
        assertEquals(gps, boundary.gps)
        val expired = evaluateArrivalNow(gps, gps, point, point, policy, clock)
        assertEquals(2, reads)
        assertEquals(ArrivalEligibility.STALE, expired.eligibility)
        assertNull(expired.gps)
    }
    @Test fun liveEvaluationKeepsRepointJitterStableWithoutBypassingSafety() {
        val worse = gps.copy(accuracy = 70.0, elapsedMillis = 100_500)
        val stable = evaluateArrivalNow(worse, gps, point, point, policy) { 100_510 }
        assertEquals(gps, stable.gps)
        assertEquals(ArrivalEligibility.READY, stable.eligibility)
        val movedPin = evaluateArrivalNow(worse, gps, point, ExecutionPoint(21.0, -103.4), policy) { 100_510 }
        assertNull(movedPin.gps)
        assertEquals(ArrivalEligibility.IMPRECISE, movedPin.eligibility)
        for ((sample, expected) in listOf(
            gps.copy(elapsedMillis = 100_511) to ArrivalEligibility.STALE,
            gps.copy(mock = true) to ArrivalEligibility.UNTRUSTED,
            gps.copy(point = ExecutionPoint(21.0, -103.4)) to ArrivalEligibility.OUTSIDE,
            null to ArrivalEligibility.NO_GPS,
        )) {
            val rejected = evaluateArrivalNow(sample, gps, point, point, policy) { 100_510 }
            assertNull(rejected.gps)
            assertEquals(expected, rejected.eligibility)
        }
        val missing = evaluateArrivalNow(gps, gps, point, null, policy) { 100_510 }
        assertNull(missing.gps)
        assertEquals(ArrivalEligibility.MISSING_POINT, missing.eligibility)
    }
}
