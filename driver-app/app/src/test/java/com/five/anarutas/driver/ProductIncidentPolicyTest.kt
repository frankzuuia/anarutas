package com.five.anarutas.driver

import java.math.BigDecimal
import org.junit.Assert.*
import org.junit.Test

class ProductIncidentPolicyTest {
    @Test fun requiresEvidenceForReplacementsAndReturnsOnly() {
        for (kind in ProductIncidentKind.entries) assertEquals(kind in setOf(ProductIncidentKind.REPLACEMENT_QUALITY,
            ProductIncidentKind.REPLACEMENT_WRONG, ProductIncidentKind.RETURN), productEvidenceRequired(kind))
    }
    @Test fun validatesQuantitiesAndPreservesDecimals() {
        for (input in listOf("", " ", "0", "-1", "NaN", "1e3", ".5", "1.", "1.0000001", "1000000000000")) assertNull(productQuantity(input))
        assertEquals(BigDecimal("0.25"), productQuantity("0,25"))
        assertEquals(BigDecimal("0.000001"), productQuantity(" 0.000001 "))
        assertEquals(BigDecimal("999999999999.999999"), productQuantity("999999999999.999999"))
    }
    @Test fun sumsOnlyTheSameOrderAndLineIncludingResolvedIncidents() {
        val record = ProductIncidentRecord("1", "order", 0, "return", "Queso", "0.1", "kg", "pending")
        val records = listOf(record, record.copy(id = "2", quantity = "0.2", status = "resolved"),
            record.copy(shipmentId = "other"), record.copy(lineIndex = 1), record.copy(lineIndex = null))
        assertEquals(0, BigDecimal("1.7").compareTo(remainingProductQuantity(2.0, records, "order", 0)))
        assertEquals(BigDecimal.ZERO, remainingProductQuantity(0.1, records, "order", 0))
        assertEquals(0, BigDecimal("2.0").compareTo(remainingProductQuantity(2.0, emptyList(), "order", 0)))
    }
    @Test fun manualProductsAndLineBasedReturnsHaveDifferentContracts() {
        for (kind in ProductIncidentKind.entries) {
            assertFalse(productIncidentValid(kind, "0", "Queso", "kg", BigDecimal.ONE, ""))
            assertFalse(productIncidentValid(kind, "1", "Queso", "kg", BigDecimal.ONE, "x".repeat(2001)))
            assertTrue(productIncidentValid(kind, "1", "Queso", "kg", BigDecimal.ONE, "x".repeat(2000)))
            if (kind.manual) {
                assertTrue(productIncidentValid(kind, "1", "x".repeat(300), "x".repeat(40), null, ""))
                for (product in listOf("", " ", "a\n", "x".repeat(301))) assertFalse(productIncidentValid(kind, "1", product, "kg", null, ""))
                for (unit in listOf("", " ", "a\n", "x".repeat(41))) assertFalse(productIncidentValid(kind, "1", "Queso", unit, null, ""))
            } else {
                assertFalse(productIncidentValid(kind, "1", "Queso", "kg", null, ""))
                assertFalse(productIncidentValid(kind, "1.000001", "Queso", "kg", BigDecimal.ONE, ""))
            }
        }
    }
}
