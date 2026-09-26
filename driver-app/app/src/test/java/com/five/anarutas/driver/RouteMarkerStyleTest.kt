package com.five.anarutas.driver

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class RouteMarkerStyleTest {
    @Test fun selectedStopKeepsItsCurrentLimeFillAndTakesPrecedenceOverArrival() {
        val selected = routeMarkerStyle(selected = true, arrived = false)
        assertEquals("#D0F58A", selected.fill)
        assertEquals("#1D2B10", selected.text)
        assertNull(selected.outline)
        assertEquals(selected, routeMarkerStyle(selected = true, arrived = true))
    }

    @Test fun everyNonSelectedStopHasVisibleOutlineAndDistinctStatus() {
        val normal = routeMarkerStyle(selected = false, arrived = false)
        val arrived = routeMarkerStyle(selected = false, arrived = true)
        assertEquals("#30353C", normal.fill)
        assertEquals("#9BCDF6", arrived.fill)
        assertNotNull(normal.outline)
        assertNotNull(arrived.outline)
        assertNotEquals(normal.fill, normal.outline)
        assertNotEquals(arrived.fill, arrived.outline)
        assertNotEquals(normal, arrived)
    }
}
