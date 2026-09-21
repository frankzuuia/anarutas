package com.five.anarutas.driver

import org.junit.Assert.*
import org.junit.Test

class ClientValidationTest {
    @Test fun phoneAndPinMatchServerContract() {
        assertEquals("3312345678", ClientValidation.phone("+52 (33) 1234-5678"))
        assertEquals("3312345678", ClientValidation.phone("+5213312345678"))
        assertEquals("3312345678", ClientValidation.phone("33 1234 5678"))
        assertNull(ClientValidation.phone("33+12345678"))
        assertNull(ClientValidation.phone("12345678901"))
        assertTrue(ClientValidation.pin("0123"))
        assertFalse(ClientValidation.pin("123"))
        assertFalse(ClientValidation.pin("12a4"))
    }
}
