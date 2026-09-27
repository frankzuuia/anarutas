package com.five.anarutas.driver

import org.junit.Assert.*
import org.junit.Test

class NavigationEtaPolicyTest {
    @Test fun destinationFenceAndReset() {
        val state = NavigationEtaState()
        assertNull(state.read("execution", "stop", true, 600))
        state.begin("key", "execution", "stop")
        assertNull(state.read("other", "stop", true, 600))
        assertNull(state.read("execution", "other", true, 600))
        assertNull(state.read("execution", null, true, 600))
        assertEquals(NavigationEta("stop", "calculating", null), state.read("execution", "stop", false, 600))
        state.ready("old-key")
        assertEquals("calculating", state.read("execution", "stop", true, 600)?.state)
        state.ready("key")
        assertEquals(NavigationEta("stop", "ready", 600), state.read("execution", "stop", true, 600))
        for (seconds in listOf(null, -1)) assertEquals("unavailable", state.read("execution", "stop", true, seconds)?.state)
        assertEquals("unavailable", state.read("execution", "stop", false, 600)?.state)
        assertEquals(0, state.read("execution", "stop", true, 0)?.remainingSeconds)
        state.begin("key2", "execution", "stop2")
        assertNull(state.read("execution", "stop", true, 600))
        assertEquals("calculating", state.read("execution", "stop2", true, 600)?.state)
        state.clear()
        assertNull(state.read("execution", "stop2", true, 600))
        assertNull(state.read(null, null, false, null))
    }
    @Test fun labelsAreEstimatesNotArrivalOrCountdown() {
        val eta = NavigationEta("stop", "ready", 1200)
        assertEquals("En atención", navigationEtaLabel(null, true, false))
        assertEquals("Sin destino activo", navigationEtaLabel(null, false, true))
        assertEquals("Tiempo desactualizado", navigationEtaLabel(eta, false, false))
        assertEquals("Calculando…", navigationEtaLabel(eta.copy(state = "calculating", remainingSeconds = null), false, true))
        assertEquals("Tiempo no disponible", navigationEtaLabel(eta.copy(state = "unavailable"), false, true))
        assertEquals("Tiempo no disponible", navigationEtaLabel(eta.copy(remainingSeconds = null), false, true))
        for ((seconds, label) in listOf(0 to "<1 min", 59 to "<1 min", 60 to "≈1 min", 61 to "≈2 min", 1200 to "≈20 min", Int.MAX_VALUE to "≈35791395 min"))
            assertEquals(label, navigationEtaLabel(eta.copy(remainingSeconds = seconds), false, true))
    }
}
