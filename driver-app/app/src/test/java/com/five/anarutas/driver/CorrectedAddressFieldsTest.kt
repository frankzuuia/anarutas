package com.five.anarutas.driver

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CorrectedAddressFieldsTest {
    @Test fun requiresFourExplicitFieldsAndFormatsThePanelAddress() {
        val address = confirmedAddressFields(" Calle nueva 230 ", " Centro ", " 44100 ", " Guadalajara ")!!
        assertEquals("Calle nueva 230, Col. Centro, C.P. 44100, Guadalajara", address.formatted)
        assertEquals("44100", address.postalCode)
        assertNull(confirmedAddressFields("", "Centro", "44100", "Guadalajara"))
        assertNull(confirmedAddressFields("Calle 1", " ", "44100", "Guadalajara"))
        assertNull(confirmedAddressFields("Calle 1", "Centro", "", "Guadalajara"))
        assertNull(confirmedAddressFields("Calle 1", "Centro", "44100", " "))
        assertNull(confirmedAddressFields("Calle\n1", "Centro", "44100", "Guadalajara"))
        assertNull(confirmedAddressFields("x".repeat(301), "Centro", "44100", "Guadalajara"))
        assertEquals(300, confirmedAddressFields("x".repeat(300), "Centro", "44100", "Guadalajara")?.street?.length)
    }
}
