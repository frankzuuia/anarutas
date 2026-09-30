package com.five.anarutas.driver

import org.junit.Assert.*
import org.junit.Test

class DriverPaymentPolicyTest {
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
