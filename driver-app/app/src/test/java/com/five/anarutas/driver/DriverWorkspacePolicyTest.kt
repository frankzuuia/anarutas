package com.five.anarutas.driver

import org.junit.Assert.*
import org.junit.Test

class DriverWorkspacePolicyTest {
    private val day = "2026-09-23"
    private val order = DeliveryOrder("o1", "S00021", "Cliente Norte", "Av. Central 100", 1, null, null, "", emptyList())
    private val route = AssignedPlan("today", label = "Ruta de hoy", date = day, vehicle = "Unidad", plate = "ABC123", routeStatus = "current", overview = null, orders = listOf(order), photoCount = 5)
    private val dashboard = DriverDashboard(DriverProfile("d1", "Chofer", "3312345678"), "America/Mexico_City", day, emptyList(), route)

    @Test fun `departure needs five photos of todays published route and actual orders`() {
        assertTrue(canStartRoute(route, day))
        assertTrue(canStartRoute(route.copy(photoCount = 8), day))
        assertFalse(canStartRoute(route.copy(photoCount = 4), day))
        assertFalse(canStartRoute(route.copy(photoCount = 0), day))
        assertFalse(canStartRoute(route.copy(orders = emptyList()), day))
        assertFalse(canStartRoute(route.copy(routeStatus = "stale"), day))
        assertFalse(canStartRoute(route.copy(routeStatus = "not_calculated"), day))
        assertFalse(canStartRoute(route.copy(startedAt = "2026-09-23T15:00:00Z"), day))
        assertFalse(canStartRoute(route.copy(date = "2026-09-22"), day))
        assertFalse(canStartRoute(route, null))
        assertFalse(canStartRoute(null, day))
    }

    @Test fun `historical and future routes never offer camera or departure`() {
        assertTrue(canPrepareRoute(route, day))
        assertFalse(canPrepareRoute(route.copy(date = "2026-09-22"), day))
        assertFalse(canPrepareRoute(route.copy(date = "2026-09-24"), day))
        assertFalse(canPrepareRoute(route.copy(startedAt = "2026-09-23T15:00:00Z"), day))
        assertFalse(canPrepareRoute(null, day))
        assertFalse(canPrepareRoute(route, null))
    }

    @Test fun `map always targets the started route today even while reading historical orders`() {
        val started = route.copy(startedAt = "2026-09-23T15:00:00Z")
        val historical = route.copy(id = "yesterday", date = "2026-09-22", startedAt = "2026-09-22T15:00:00Z")
        val state = DriverUiState(dashboard = dashboard.copy(today = started), selected = historical)
        assertEquals(historical, state.activePlan())
        assertEquals(started, state.runningPlan())
        assertNull(state.copy(dashboard = dashboard).runningPlan())
        assertNull(state.copy(dashboard = null).runningPlan())
        assertEquals(route, DriverUiState(dashboard = dashboard).activePlan())
        assertNull(DriverUiState().activePlan())
    }

    @Test fun `revocation removes the persistent map shortcut without logging out`() {
        val started = route.copy(startedAt = "2026-09-23T15:00:00Z")
        val state = DriverUiState(token = "retained-session", dashboard = dashboard.copy(today = started), selected = started, destination = DriverDestination.UNIT, showPhotos = true)
        val after = reconcilePublishedRoutes(state, dashboard.copy(today = null))
        assertNull(after.runningPlan())
        assertNull(after.activePlan())
        assertFalse(after.showPhotos)
        assertEquals("retained-session", after.token)
        assertEquals(DriverDestination.HOME, after.destination)
    }

    @Test fun `search filters locally by customer folio and address without reordering`() {
        val second = order.copy(id = "o2", name = "S00022", customer = "Cliente Sur", address = "Calle Primera 2", position = 2)
        val orders = listOf(order, second)
        assertEquals(orders, filterDriverOrders(orders, "  "))
        assertEquals(orders, filterDriverOrders(orders, "cliente"))
        assertEquals(listOf(order), filterDriverOrders(orders, "  NORTE  "))
        assertEquals(listOf(second), filterDriverOrders(orders, "s00022"))
        assertEquals(listOf(second), filterDriverOrders(orders, "PRIMERA"))
        assertTrue(filterDriverOrders(orders, "no-existe").isEmpty())
        assertTrue(filterDriverOrders(emptyList(), "Norte").isEmpty())
    }

    @Test fun `vehicle identity never fabricates a missing plate`() {
        assertEquals("Unidad · ABC123", vehicleLabel("Unidad", "ABC123"))
        assertEquals("Unidad", vehicleLabel("Unidad", ""))
    }

    @Test fun `formatters handle exact boundaries absent data and invalid dates`() {
        assertEquals("1.0 km", formatRouteDistance(1000))
        assertEquals("0 m", formatRouteDistance(0))
        assertEquals("1 h", formatRouteDuration(3600))
        assertEquals("0 min", formatRouteDuration(0))
        assertEquals("invalid", formatServiceDate("invalid"))
        assertEquals("Miércoles 23 de septiembre", formatServiceDate(day))
        assertEquals("Pendiente", formatRouteTime("", "America/Mexico_City"))
        assertEquals("Pendiente", formatRouteTime("2026-09-23T15:00:00Z", "invalid"))
        assertEquals("123", formatDriverPhone("123"))
        assertEquals(DashboardLoadState.READY, dashboardLoadState(dashboard, true))
    }
}
