package com.five.anarutas.driver

import androidx.compose.ui.graphics.vector.PathParser
import org.junit.Assert.*
import org.junit.Test

class IncidentFormPolicyTest {
    @Test fun arrivalOnlyOffersClosedAndRejectedWhileOrderShortagesRemain() {
        assertEquals(listOf(IncidentChoice.CUSTOMER_CLOSED, IncidentChoice.ORDER_REJECTED), arrivalIncidentChoices)
        assertEquals(listOf(ProductIncidentKind.SHORTAGE_VALIDATION, ProductIncidentKind.SHORTAGE_WAREHOUSE),
            ProductIncidentKind.entries.filter { it.manual })
    }
    @Test fun incidentCardsKeepExactExistingCodesAndDistinctIcons() {
        assertEquals(4, IncidentChoice.entries.size)
        assertEquals("customer_closed", IncidentChoice.CUSTOMER_CLOSED.code)
        assertEquals("reject", IncidentChoice.ORDER_REJECTED.code)
        assertEquals("Cliente cerrado", IncidentChoice.CUSTOMER_CLOSED.label)
        assertEquals("Pedido rechazado", IncidentChoice.ORDER_REJECTED.label)
        assertEquals("Fotografía del negocio", IncidentChoice.CUSTOMER_CLOSED.detail)
        assertEquals("Selecciona el motivo", IncidentChoice.ORDER_REJECTED.detail)
        assertEquals(DriverIcon.STORE_CLOSED, IncidentChoice.CUSTOMER_CLOSED.icon)
        assertEquals(DriverIcon.ORDER_REJECTED, IncidentChoice.ORDER_REJECTED.icon)
        IncidentChoice.entries.forEach { assertTrue(PathParser().parsePathString(it.icon.path).toNodes().isNotEmpty()) }
    }

    @Test fun choicesNeverBypassExistingAvailabilityOrOrderRestriction() {
        for (choice in listOf(IncidentChoice.SHORTAGE_VALIDATION, IncidentChoice.SHORTAGE_WAREHOUSE)) {
            assertFalse(incidentChoiceEnabled(choice, true, false))
            assertFalse(incidentChoiceEnabled(choice, false, true))
            assertTrue(incidentChoiceEnabled(choice, true, true))
        }
        for (hasOrders in listOf(false, true)) {
            assertFalse(incidentChoiceEnabled(IncidentChoice.CUSTOMER_CLOSED, false, hasOrders))
            assertFalse(incidentChoiceEnabled(IncidentChoice.ORDER_REJECTED, false, hasOrders))
            assertTrue(incidentChoiceEnabled(IncidentChoice.CUSTOMER_CLOSED, true, hasOrders))
            assertEquals(hasOrders, incidentChoiceEnabled(IncidentChoice.ORDER_REJECTED, true, hasOrders))
        }
    }

    @Test fun emptyWhitespaceAndMultilineNotesRemainUnmodifiedWithinLimit() {
        for (text in listOf("", "  ", "  nota del chofer  ", "Línea 1\nLínea 2\nLínea 3\nLínea 4\nLínea 5", "áéíóú 🏪")) {
            assertEquals(text, incidentNote(text))
        }
    }

    @Test fun exactNoteLimitAndOverflowKeepExistingContract() {
        assertEquals("a".repeat(1999), incidentNote("a".repeat(1999)))
        assertEquals("a".repeat(2000), incidentNote("a".repeat(2000)))
        assertEquals("a".repeat(2000), incidentNote("a".repeat(2000) + "b"))
        assertEquals("a".repeat(2000), incidentNote("a".repeat(4000)))
    }
}
