package com.five.anarutas.driver

import org.junit.Assert.*
import org.junit.Test

class DriverPaymentPolicyTest {
    @Test fun collectionUsesTheOfficialAmountWithoutAnEditablePurePaymentAmount() {
        for (method in listOf("cash", "transfer", "credit")) {
            val result = collectionPaymentPreview(method, "invalid", "", "2383.38", "0.01")!!
            assertEquals(if (method == "credit") "0" else "2383.38", result.tendered.toPlainString())
            assertEquals(if (method == "cash") "2383.38" else "0", result.cash.toPlainString())
            assertEquals(if (method == "transfer") "2383.38" else "0", result.transfer.toPlainString())
            assertEquals(if (method == "credit") "2383.38" else "0.00", result.balance.toPlainString())
            assertNotNull(collectionPaymentPreview(method, "", "", "0", "0.01"))
        }
    }
    @Test fun combinedCollectionRequiresTwoPositiveExactComponents() {
        val result = collectionPaymentPreview("mixed", "1000", "1383.38", "2383.38", "0.01")!!
        assertEquals("2383.38", result.tendered.toPlainString())
        assertEquals("1000", result.cash.toPlainString())
        assertEquals("1383.38", result.transfer.toPlainString())
        for ((cash, transfer) in listOf("" to "2383.38", "2383.38" to "", "0" to "2383.38", "2383.38" to "0", "1000" to "1383.37", "1000.001" to "1383.379", "-1" to "2384.38", "NaN" to "0", "1e1000000" to "1", "9".repeat(81) to "1"))
            assertNull("$cash/$transfer", collectionPaymentPreview("mixed", cash, transfer, "2383.38", "0.01"))
        assertNull(collectionPaymentPreview("mixed", "0", "0", "0", "0.01"))
    }
    @Test fun collectionRejectsUnknownMethodsAndInvalidSourceWithoutTruncation() {
        for (method in listOf("", "other")) assertNull(collectionPaymentPreview(method, "", "", "20", "0.01"))
        for (expected in listOf(null, "", "-1", "Infinity", "20.001", "1e1000000", "9".repeat(81)))
            assertNull(collectionPaymentPreview("cash", "", "", expected, "0.01"))
        for (step in listOf(null, "0", "-1", "NaN")) assertNull(collectionPaymentPreview("cash", "", "", "20", step))
        assertNull(collectionPaymentPreview("cash", "", "", "1.01", "0.05"))
        assertNotNull(collectionPaymentPreview("mixed", "1.05", "1.10", "2.15", "0.05"))
    }
    @Test fun netCaptureRequiresExplicitCashOrTransferAndPreservesExactBalances() {
        for (method in listOf("cash", "transfer")) {
            for (invalid in listOf("", " ", "-1", "20.001", "21", "NaN"))
                assertNull("$method/$invalid", paymentCapturePreview(method, invalid, "20", "0.01"))
            val partial = paymentCapturePreview(method, "15.25", "20", "0.01")!!
            assertEquals("15.25", partial.tendered.toPlainString())
            assertEquals("15.25", partial.received.toPlainString())
            assertEquals("0", partial.change.toPlainString())
            assertEquals("4.75", partial.balance.toPlainString())
            assertEquals("0", paymentCapturePreview(method, "20", "20", "0.01")!!.balance.toPlainString())
            assertEquals("20", paymentCapturePreview(method, "0", "20", "0.01")!!.balance.toPlainString())
            assertEquals("0", paymentCapturePreview(method, "0", "0", "0.01")!!.received.toPlainString())
            assertNull(paymentCapturePreview(method, "20", null, "0.01"))
            assertNull(paymentCapturePreview(method, "20", "20", null))
        }
        assertNull(paymentCapturePreview("", "20", "20", "0.01"))
        assertNull(paymentCapturePreview("mixed", "20", "20", "0.01"))
    }
    @Test fun netCaptureCreditDoesNotReuseAnAmountFromThePreviousMethod() {
        for (previous in listOf("", "15.25", "20", "invalid")) {
            val credit = paymentCapturePreview("credit", previous, "20", "0.01")!!
            assertEquals("0", credit.tendered.toPlainString())
            assertEquals("0", credit.received.toPlainString())
            assertEquals("0", credit.change.toPlainString())
            assertEquals("20", credit.balance.toPlainString())
        }
    }
    private fun preview(method: String = "cash", tendered: String = "20", change: String = "0", expected: String? = "20", step: String? = "0.01") =
        paymentPreview(method, tendered, change, expected, step)
    @Test fun exactCashPartialCashAndChange() {
        assertEquals("0", preview()!!.balance.toPlainString())
        assertEquals("5", preview(tendered = "15")!!.balance.toPlainString())
        val result = preview(tendered = "50", change = "30")!!
        assertEquals("20", result.received.toPlainString())
        assertEquals("30", result.change.toPlainString())
        assertNotNull(preview(tendered = "0", expected = "0"))
    }
    @Test fun methodChangesNeverTurnCreditOrTransferIntoCash() {
        val credit = preview("credit", "50", "30")!!
        assertEquals("0", credit.received.toPlainString())
        assertEquals("20", credit.balance.toPlainString())
        val transfer = preview("transfer", "20", "30")!!
        assertEquals("0", transfer.change.toPlainString())
        assertNull(preview("other"))
        assertNull(preview(""))
    }
    @Test fun rejectsInvalidMoneyWithoutRoundingAwayAnError() {
        for (amount in listOf("", "NaN", "Infinity", "-1", "0.001", "21", "1e1000000", "9".repeat(81))) assertNull(amount, preview(tendered = amount))
        assertNull(preview(tendered = "15", change = "1"))
        assertNull(preview(tendered = "1", change = "2"))
        assertNull(preview(change = "-1"))
        assertNull(preview(expected = null))
        assertNull(preview(expected = "-1"))
        assertNull(preview(step = null))
        assertNull(preview(step = "0"))
        assertNull(preview(step = "-1"))
        assertNull(preview(tendered = "1.01", expected = "1.01", step = "0.05"))
        assertNotNull(preview(tendered = "1.05", expected = "1.05", step = "0.05"))
    }
    @Test fun ambiguousOutcomesKeepTheOriginalCommandForRecovery() {
        for (code in listOf(401, 408, 429, 500, 502, 503)) assertTrue(code.toString(), financeCommandRetryable(code))
        for (code in listOf(400, 403, 404, 409, 422, 499)) assertFalse(code.toString(), financeCommandRetryable(code))
    }
    @Test fun delayedResponsesCannotReplaceANewRoutePageOrLogin() {
        val current = FinanceReadTarget("route-a", 0)
        assertTrue(financeReadStillCurrent(current, current, "device-a", "device-a"))
        assertFalse(financeReadStillCurrent(current, current.copy(executionId = "route-b"), "device-a", "device-a"))
        assertFalse(financeReadStillCurrent(current, current.copy(executionId = null), "device-a", "device-a"))
        assertFalse(financeReadStillCurrent(current, current.copy(page = 1), "device-a", "device-a"))
        assertFalse(financeReadStillCurrent(current, current, "device-a", "device-b"))
    }
}
