package com.five.anarutas.driver

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PolylinePreviewTest {
    @Test fun `decodes a stored route without any service call`() {
        val points = decodePreviewPolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")
        assertEquals(3, points.size)
        assertEquals(38.5, points[0].latitude, 0.00001)
        assertEquals(-120.2, points[0].longitude, 0.00001)
        assertEquals(43.252, points[2].latitude, 0.00001)
        assertEquals(-126.453, points[2].longitude, 0.00001)
    }

    @Test fun `rejects broken or oversized polylines instead of drawing an invented path`() {
        assertTrue(decodePreviewPolyline("_").isEmpty())
        assertTrue(decodePreviewPolyline("~").isEmpty())
        assertTrue(decodePreviewPolyline("a".repeat(200_001)).isEmpty())
        assertTrue(decodePreviewPolyline("~~~~~~~").isEmpty())
    }
}
