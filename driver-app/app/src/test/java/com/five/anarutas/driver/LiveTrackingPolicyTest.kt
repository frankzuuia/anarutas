package com.five.anarutas.driver

import org.junit.Assert.*
import org.junit.Test

class LiveTrackingPolicyTest {
    private val fix = DriverGps(ExecutionPoint(20.6, -103.4), 8.0, 1000, false)
    @Test fun onlyRealFiniteRecentSamples() {
        assertEquals(fix, trackingGps(fix, 2000, 1000))
        assertNull(trackingGps(fix, 2001, 1000))
        assertNull(trackingGps(fix, 999, 1000))
        assertNull(trackingGps(null, 2000, 1000))
        assertNull(trackingGps(fix.copy(mock = true), 2000, 1000))
        assertNull(trackingGps(fix.copy(accuracy = Double.NaN), 2000, 1000))
        assertNull(trackingGps(fix.copy(accuracy = -1.0), 2000, 1000))
        assertNull(trackingGps(fix.copy(point = ExecutionPoint(91.0, 0.0)), 2000, 1000))
        assertNull(trackingGps(fix.copy(point = ExecutionPoint(0.0, -181.0)), 2000, 1000))
        assertNull(trackingGps(fix.copy(point = ExecutionPoint(Double.NaN, 0.0)), 2000, 1000))
        assertNull(trackingGps(fix.copy(point = ExecutionPoint(0.0, Double.NaN)), 2000, 1000))
        assertNull(trackingGps(fix.copy(point = ExecutionPoint(-91.0, 0.0)), 2000, 1000))
        assertNull(trackingGps(fix.copy(point = ExecutionPoint(0.0, 181.0)), 2000, 1000))
        assertNull(trackingGps(fix.copy(accuracy = Double.POSITIVE_INFINITY), 2000, 1000))
        val boundary = fix.copy(point = ExecutionPoint(-90.0, 180.0), accuracy = 0.0)
        assertEquals(boundary, trackingGps(boundary, 1000, 1000))
        val otherBoundary = fix.copy(point = ExecutionPoint(90.0, -180.0))
        assertEquals(otherBoundary, trackingGps(otherBoundary, 1000, 1000))
    }
    @Test fun stopsOnRevocationButRecoversTransientFailures() {
        listOf(401,403,404,409).forEach { assertTrue(trackingMustStop(it)) }
        listOf(400,408,429,500,503).forEach { assertFalse(trackingMustStop(it)) }
    }
}
