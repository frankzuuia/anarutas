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

    private fun receipt(action: String = "product-incident") = ExecutionUiState(loading = false, verified = true,
        productRevision = 3, lastProductIncidentId = id, lastProductAction = action,
        lastProductStopId = "stop", lastProductShipmentId = "order")
    private fun closes(state: ExecutionUiState = receipt(), previous: Int = 2, editing: String? = null) =
        productFormCloseConfirmed(state, previous, "stop", "order", editing)

    @Test fun confirmedCreateAmendAndCancellationReturnToTheirOrder() {
        assertTrue(closes())
        assertTrue(closes(receipt("product-incident-amend"), editing = id))
        assertTrue(closes(receipt("product-incident-cancel"), editing = id))
        assertTrue(closes(receipt().copy(lastProductIncidentId = id.uppercase())))
    }
    @Test fun uncertainRefreshAndBusySendingPreserveTheFormUntilSettled() {
        assertFalse(closes(receipt().copy(verified = false)))
        assertFalse(closes(receipt().copy(busy = true)))
        assertFalse(closes(receipt().copy(pending = true)))
        assertFalse(closes(receipt().copy(retired = true)))
        assertTrue(closes(receipt().copy(busy = false, pending = false)))
        for (invalid in listOf(null, "", "not-a-receipt")) assertFalse(closes(receipt().copy(lastProductIncidentId = invalid)))
    }
    @Test fun unrelatedStopsOrdersActionsAndIncidentsCannotCloseThisForm() {
        assertFalse(closes(receipt().copy(lastProductStopId = "other")))
        assertFalse(closes(receipt().copy(lastProductStopId = null)))
        assertFalse(closes(receipt().copy(lastProductShipmentId = "other")))
        assertFalse(closes(receipt().copy(lastProductShipmentId = null)))
        assertFalse(closes(receipt(), editing = id))
        assertFalse(closes(receipt("product-incident-amend")))
        assertFalse(closes(receipt("product-incident-amend"), editing = "other"))
        assertFalse(closes(receipt("product-incident-cancel"), editing = "other"))
        assertFalse(closes(receipt("service")))
        assertFalse(closes(receipt().copy(lastProductAction = null)))
    }
    @Test fun replayReopeningAndRotationBaselineDoNotConsumeAnOldReceipt() {
        assertFalse(closes(previous = 3))
        assertFalse(closes(previous = 4))
        // Saved revision 2 survives rotation while sending; the same confirmed revision 3 closes once.
        assertTrue(closes(previous = 2))
        assertFalse(closes(receipt("product-incident-amend"), previous = 3, editing = id))
    }
}
