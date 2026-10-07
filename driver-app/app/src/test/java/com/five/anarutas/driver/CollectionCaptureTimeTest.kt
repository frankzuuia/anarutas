package com.five.anarutas.driver

import java.time.Instant
import org.junit.Assert.*
import org.junit.Test

class CollectionCaptureTimeTest {
    @Test fun capturesThirtyMinutesFromTheServerAnchor() {
        val server = Instant.parse("2026-10-06T15:00:00Z")
        assertEquals(server.plusSeconds(1800), collectionCaptureTime(server, 100_000L, 1_900_000L))
        assertEquals(server, collectionCaptureTime(server, 100_000L, 100_000L))
    }
    @Test fun rejectsAnAnchorFromBeforeAReboot() {
        assertNull(collectionCaptureTime(Instant.EPOCH, 100_000L, 99_999L))
    }
    @Test fun crossesMidnightWithoutUsingTheDeviceCalendar() {
        val capture = collectionCaptureTime(Instant.parse("2026-10-06T23:59:30.123Z"), 100L, 60100L)!!.toString()
        assertEquals("2026-10-07T00:00:30.123Z", capture)
    }
}
