package com.five.anarutas.driver

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.IOException

class DriverEventParserTest {
    @Test
    fun `emits only complete events without leaking data fields into event names`() {
        val parser = DriverEventParser()
        assertEquals(null, parser.accept(": heartbeat"))
        assertEquals(null, parser.accept("event: change"))
        assertEquals(null, parser.accept("data: {}"))
        assertEquals("change", parser.accept(""))
        assertEquals(null, parser.accept(""))
        assertEquals(null, parser.accept("event: reset"))
        assertEquals("reset", parser.accept(""))
    }

    @Test(expected = IOException::class)
    fun `rejects oversized event lines`() {
        DriverEventParser().accept("event: " + "x".repeat(1025))
    }
}
