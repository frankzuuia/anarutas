package com.five.anarutas.driver

import org.junit.Assert.*
import org.junit.Test

class ClientValidationTest {
    @Test fun serverRequiresHttpsOriginWithoutPathOrCredentials() {
        assertEquals("https://develop.example.com", ClientValidation.serverOrigin(" https://develop.example.com/ "))
        assertNull(ClientValidation.serverOrigin("http://develop.example.com"))
        assertNull(ClientValidation.serverOrigin("https://develop.example.com/api"))
        assertNull(ClientValidation.serverOrigin("https://user:pass@develop.example.com"))
    }

    @Test fun phoneAndPinMatchServerContract() {
        assertEquals("523312345678", ClientValidation.phone("+52 (33) 1234-5678"))
        assertNull(ClientValidation.phone("33+12345678"))
        assertTrue(ClientValidation.pin("0123"))
        assertFalse(ClientValidation.pin("123"))
        assertFalse(ClientValidation.pin("12a4"))
    }

    @Test fun activationCodeHasExactHexShape() {
        assertTrue(ClientValidation.activationCode("a".repeat(64)))
        assertFalse(ClientValidation.activationCode("g".repeat(64)))
        assertFalse(ClientValidation.activationCode("a".repeat(63)))
    }
}
