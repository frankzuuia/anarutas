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
}
