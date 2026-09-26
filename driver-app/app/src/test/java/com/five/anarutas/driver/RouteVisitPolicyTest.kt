package com.five.anarutas.driver

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RouteVisitPolicyTest {
    private fun stop(id: String, arrived: Boolean) = ExecutionStop(id, 1, id, "Domicilio", listOf(id),
        null, 1, 1, false, if (arrived) "2026-09-25T10:00:00.000Z" else null, if (arrived) 1 else 0)

    @Test fun switchingFromAnArrivedStopExitsItEvenAfterConsultingAnotherStop() {
        val stops = listOf(stop("primera", true), stop("segunda", false))
        assertEquals("primera", activeVisitToExit(stops, "segunda")?.id)
        assertNull(activeVisitToExit(stops, "primera"))
    }

    @Test fun doesNotInventExitWhenNoStopHasAnActiveArrival() {
        assertNull(activeVisitToExit(listOf(stop("primera", false), stop("segunda", false)), "segunda"))
    }
}
