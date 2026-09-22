package com.five.anarutas.driver

import org.junit.Assert.assertEquals
import org.junit.Test

class DriverDashboardPolicyTest {
    @Test
    fun `initial dashboard request is loading instead of a false failure`() {
        assertEquals(DashboardLoadState.LOADING, dashboardLoadState(null, true))
        assertEquals(DashboardLoadState.FAILED, dashboardLoadState(null, false))
    }

    @Test
    fun `route metrics are formatted without inventing missing values`() {
        assertEquals("Pendiente", formatRouteDistance(null))
        assertEquals("850 m", formatRouteDistance(850))
        assertEquals("109.6 km", formatRouteDistance(109_600))
        assertEquals("Pendiente", formatRouteDuration(null))
        assertEquals("47 min", formatRouteDuration(2_820))
        assertEquals("6 h 13 min", formatRouteDuration(22_380))
    }

    @Test
    fun `server timezone controls displayed schedule`() {
        assertEquals(
            "07:30",
            formatRouteTime("2026-09-21T13:30:00.000Z", "America/Mexico_City"),
        )
        assertEquals("Pendiente", formatRouteTime(null, "America/Mexico_City"))
        assertEquals("Pendiente", formatRouteTime("invalid", "America/Mexico_City"))
    }

    @Test
    fun `dashboard labels preserve operational truth`() {
        assertEquals("Recorrido vigente", routeStatusLabel("current"))
        assertEquals("Requiere actualización", routeStatusLabel("stale"))
        assertEquals("Sin recorrido calculado", routeStatusLabel("not_calculated"))
        assertEquals("Ruta sin pedidos", routeStatusLabel("empty"))
        assertEquals("Estado no disponible", routeStatusLabel("unknown"))
        assertEquals("33 1234 5678", formatDriverPhone("+52 (33) 1234-5678"))
    }

    @Test
    fun `today route is never duplicated in history`() {
        val todaySummary = summary("today", "2026-09-21")
        val oldSummary = summary("old", "2026-09-20")
        val today = AssignedPlan(
            id = "today",
            label = "Hoy",
            date = "2026-09-21",
            vehicle = "Unidad A",
            plate = "AAA-001",
            routeStatus = "not_calculated",
            overview = null,
            orders = emptyList(),
        )
        val dashboard = DriverDashboard(
            driver = DriverProfile("driver", "Chofer", "3312345678"),
            timezone = "America/Mexico_City",
            serviceDate = "2026-09-21",
            plans = listOf(todaySummary, oldSummary),
            today = today,
        )
        assertEquals(listOf(oldSummary), otherPlans(dashboard))
    }

    private fun summary(id: String, date: String) = PlanSummary(
        id = id,
        label = id,
        date = date,
        vehicle = "Unidad",
        plate = "AAA-001",
        orderCount = 1,
    )
}
