package com.five.anarutas.driver

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.math.BigDecimal

class DriverFinancialTest {
    private fun view() = DriverFinancialView(1, "ready", true, null,
        Instant.parse("2026-09-30T16:00:00Z"), Instant.parse("2026-09-30T16:00:00Z"),
        180, 1_000_000, DriverCurrency("MXN", 2), emptyList(), emptyList(), 0, null)

    @Test fun freshnessUsesMonotonicTimeAndRejectsExpiredErrorOrFutureData() {
        val v = view()
        assertTrue(financialFresh(v, v.receivedNanos + 180_000_000_000))
        assertFalse(financialFresh(v, v.receivedNanos + 180_001_000_000))
        assertFalse(financialFresh(v, 0))
        assertFalse(financialFresh(v.copy(error = "ODOO_UNAVAILABLE"), v.receivedNanos))
        assertFalse(financialFresh(v.copy(fresh = false), v.receivedNanos))
        assertFalse(financialFresh(v.copy(checkedAt = null), v.receivedNanos))
        assertFalse(financialFresh(v.copy(checkedAt = v.serverTime.plusSeconds(1)), v.receivedNanos))
        assertFalse(financialFresh(null, v.receivedNanos))
    }
    @Test fun monetaryPresentationPreservesSourcePrecisionAndCurrency() {
        assertEquals("$3,538.00 MXN", financialMoney("3538", DriverCurrency("MXN", 2)))
        assertEquals("$0.000001 MXN", financialMoney("0.000001", DriverCurrency("MXN", 2)))
        assertEquals("JPY1,000 JPY", financialMoney("1000", DriverCurrency("JPY", 0)))
        assertEquals("−$0.01 MXN", financialMoney("-0.01", DriverCurrency("MXN", 2)))
        assertEquals("$1,086.50 MXN", financialMoney("1086.500000", DriverCurrency("MXN", 2)))
        assertEquals("$9,007,199,254,740,993.01 MXN", financialMoney("9007199254740993.01", DriverCurrency("MXN", 2)))
        assertEquals("$0.00 MXN", financialMoney("-0", DriverCurrency("MXN", 2)))
        assertEquals("Por confirmar", financialMoney("1", null))
        assertEquals("BTC0.00000001 BTC", financialMoney("0.00000001", DriverCurrency("BTC", 8)))
    }
    @Test fun liquidationOnlyShowsDeliveredOrdersWithConfirmedPayment() {
        assertFalse(liquidationOrderVisible("open", false))
        assertFalse(liquidationOrderVisible("delivered", false))
        assertTrue(liquidationOrderVisible("delivered", true))
        assertFalse(liquidationOrderVisible("open", true))
        assertFalse(liquidationOrderVisible("rescheduled", true))
    }
    @Test fun liquidationQuantityShowsTheDeliveredUnitAfterThreeOfFourWereReturned() {
        val line = DriverFinancialLine(0, 100, 10, "4", "Unidades", "83.21", "0", "332.84", "1.000000", "83.21", "249.63", "0")
        assertEquals("1", liquidationQuantityText(line))
        assertEquals("4", line.quantity)
        assertEquals("332.84", line.total)
        assertEquals("249.63", line.deduction)
        assertEquals("0", liquidationQuantityText(line.copy(physicalRemaining = "0.000000", net = "0")))
    }
    @Test fun deliveredQuantityKeepsFractionalPrecisionEvenWhenMoneyIsZero() {
        val line = DriverFinancialLine(0, 100, 10, "5.25", "kg", "0", "100", "0", "1.00000100", "0", "0", "0")
        assertEquals("1.000001", liquidationQuantityText(line))
        assertEquals("5.25", liquidationQuantityText(line.copy(physicalRemaining = "5.250000")))
    }
    @Test fun linkedShortagesUseFinalDecimalQuantityAndExcludeOnlyTheEditedIncident() {
        val record = ProductIncidentRecord("one", "order", 0, "shortage_validation", "Producto", "5", "kg", "pending")
        val remaining = remainingProductQuantity(BigDecimal("5.12"), listOf(record), "order", 0)
        assertEquals(0, remaining.compareTo(BigDecimal("0.12")))
        assertTrue(productIncidentValid(ProductIncidentKind.SHORTAGE_VALIDATION, "0.12", "", "", remaining, "", linked = true))
        assertFalse(productIncidentValid(ProductIncidentKind.SHORTAGE_VALIDATION, "0.120001", "", "", remaining, "", linked = true))
        assertEquals(0, remainingProductQuantity(BigDecimal("5.12"), listOf(record), "order", 0, "one").compareTo(BigDecimal("5.12")))
    }
    @Test fun stableReferencesDistinguishRevisionsAndStockMoves() {
        val reference = IncidentFinancialReference(1, 100, 10)
        assertEquals("1:100:10", reference.key)
        assertNotEquals(reference, reference.copy(revision = 2))
        assertNotEquals(reference, reference.copy(moveId = 101))
    }
}
