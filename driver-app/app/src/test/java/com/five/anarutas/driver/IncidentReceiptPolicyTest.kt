package com.five.anarutas.driver

import org.junit.Assert.*
import org.junit.Test

class IncidentReceiptPolicyTest {
    private val id = "2f056b89-1145-4d89-abc1-3293b3e45108"
    @Test fun noConfirmedReceiptCannotAnnounceSuccess() {
        assertNull(confirmedIncidentReceipt(false, null))
        assertNull(confirmedIncidentReceipt(false, id))
    }
    @Test fun durableCanonicalReceiptIsRequired() {
        assertEquals(id, confirmedIncidentReceipt(true, id))
        assertEquals(id, confirmedIncidentReceipt(true, id.uppercase()))
        for (bad in listOf(null, "", "invalid", "1-1-1-1-1", " $id", "$id ")) {
            assertThrows(IllegalStateException::class.java) { confirmedIncidentReceipt(true, bad) }
        }
    }
}
