package com.five.anarutas.driver

import org.junit.Assert.*
import org.junit.Test

class DriverReceiptOrderTest {
    @Test fun newCollectionsFollowExistingOnesRegardlessOfRoutePosition() {
        val first = "2026-10-01T16:00:00.001Z"
        val next = "2026-10-01T16:00:00.002Z"
        assertTrue(compareCollectionReceipts(first, "b", next, "a") < 0)
        assertTrue(compareCollectionReceipts(next, "a", first, "b") > 0)
    }
    @Test fun simultaneousCollectionsKeepStableOrderIncludingEquivalentInstants() {
        val utc = "2026-10-01T16:00:00.001Z"
        val local = "2026-10-01T10:00:00.001-06:00"
        assertTrue(compareCollectionReceipts(local, "a", utc, "b") < 0)
        assertTrue(compareCollectionReceipts(utc, "b", local, "a") > 0)
        assertEquals(0, compareCollectionReceipts(utc, "b", local, "b"))
    }
}
