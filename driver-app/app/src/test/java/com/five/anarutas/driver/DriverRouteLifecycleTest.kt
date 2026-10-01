package com.five.anarutas.driver

import org.junit.Assert.*
import org.junit.Test

class DriverRouteLifecycleTest {
    private val route = AssignedPlan("route", label = "Ruta", date = "2026-10-01", vehicle = "Unidad", plate = "",
        routeStatus = "current", overview = null, orders = emptyList(), startedAt = "2026-10-01T12:00:00Z", publicationRevision = 3)
    private val plan = PlanSummary(route.id, route.label, route.date, route.vehicle, "", 2, 3)
    private val dashboard = DriverDashboard(DriverProfile("driver", "Chofer", ""), "America/Mexico_City", route.date, listOf(plan), route)
    private val closed = dashboard.copy(plans = listOf(plan.copy(workCompletedAt = "2026-10-01T16:00:00Z")), today = null)

    @Test fun confirmedClosureClearsCurrentOrdersAndMapButKeepsFinancialSummary() {
        val state = DriverUiState(token = "session", dashboard = dashboard, selected = route,
            destination = DriverDestination.FINANCE, orderDetailId = "order", showPhotos = true, openStartedMap = route.id)
        val after = reconcilePublishedRoutes(state, closed)
        assertNull(after.selected)
        assertNull(after.activePlan())
        assertNull(after.runningPlan())
        assertNull(after.orderDetailId)
        assertNull(after.openStartedMap)
        assertFalse(after.showPhotos)
        assertEquals(DriverDestination.FINANCE, after.destination)
        assertEquals("session", after.token)
        assertEquals(1, after.dashboard!!.plans.size)
        assertEquals("Ruta finalizada. Puedes consultar tus tickets y el resumen en el historial.", after.notice)
        assertEquals(DriverDestination.HOME, reconcilePublishedRoutes(state.copy(destination = DriverDestination.ROUTE), closed).destination)
    }

    @Test fun closureDoesNotReplaceAnotherPublicationOrRoute() {
        assertFalse(driverWorkFinishedTransition(route, dashboard))
        assertFalse(driverWorkFinishedTransition(null, closed))
        assertFalse(driverWorkFinishedTransition(route, closed.copy(plans = listOf(closed.plans.single().copy(id = "other")))))
        assertFalse(driverWorkFinishedTransition(route, closed.copy(plans = listOf(closed.plans.single().copy(publicationRevision = 4)))))
        assertTrue(driverWorkFinishedTransition(route, closed))
    }

    @Test fun historyOfCompletedWorkRemainsConsultableWithoutRepeatingTheTransition() {
        val historic = route.copy(completedAt = "2026-10-01T16:00:00Z", workCompletedAt = "2026-10-01T16:00:00Z")
        assertFalse(driverWorkFinishedTransition(historic, closed))
        val state = DriverUiState(dashboard = closed, selected = historic, destination = DriverDestination.ROUTE)
        assertEquals(historic, reconcilePublishedRoutes(state, closed, historic).selected)
        assertNull(state.runningPlan())
        assertFalse(canStartRoute(historic, route.date))
    }

    @Test fun anotherCurrentRouteIsSelectedAfterClosure() {
        val next = route.copy(id = "next", startedAt = null, publicationRevision = 1)
        val latest = closed.copy(today = next, plans = closed.plans + plan.copy(id = "next", publicationRevision = 1))
        val state = DriverUiState(dashboard = dashboard, selected = route, destination = DriverDestination.ORDERS)
        assertEquals(next, reconcilePublishedRoutes(state, latest).selected)
        assertEquals(DriverDestination.HOME, reconcilePublishedRoutes(state, latest).destination)
    }

    @Test fun financialSummaryIsPreservedOnlyForTheConfirmedWorkTransition() {
        assertTrue(keepFinanceSummaryOpen(DriverDestination.FINANCE, true))
        assertFalse(keepFinanceSummaryOpen(DriverDestination.FINANCE, false))
        assertFalse(keepFinanceSummaryOpen(DriverDestination.HOME, true))
    }
}
