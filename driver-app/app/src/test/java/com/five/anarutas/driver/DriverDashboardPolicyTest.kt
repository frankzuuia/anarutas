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

    @Test
    fun `withdrawing a started route clears driver screens while keeping the session`() {
        val assigned = AssignedPlan(
            id = "route-1", label = "Ruta", date = "2026-09-23", vehicle = "Unidad A",
            plate = "AAA-001", routeStatus = "current", overview = null, orders = emptyList(),
            startedAt = "2026-09-23T14:00:00Z",
        )
        val profile = DriverProfile("driver", "Chofer", "3312345678")
        val priorDashboard = DriverDashboard(profile, "America/Mexico_City", "2026-09-23", listOf(summary("route-1", "2026-09-23")), assigned)
        val state = DriverUiState(
            initializing = false, token = "session", dashboard = priorDashboard, selected = assigned,
            destination = DriverDestination.ROUTE, orderDetailId = "order-1", showPhotos = true,
        )
        val withdrawn = DriverDashboard(profile, "America/Mexico_City", "2026-09-23", emptyList(), null)
        val reconciled = reconcilePublishedRoutes(state, withdrawn)
        assertEquals("session", reconciled.token)
        assertEquals(null, reconciled.selected)
        assertEquals(DriverDestination.HOME, reconciled.destination)
        assertEquals(null, reconciled.orderDetailId)
        assertEquals(false, reconciled.showPhotos)

        val unchanged = reconcilePublishedRoutes(state, priorDashboard)
        assertEquals(DriverDestination.ROUTE, unchanged.destination)
        assertEquals("route-1", unchanged.selected?.id)
    }

    @Test
    fun `photo deletion is offered only for a listed photo before route start`() {
        val route = AssignedPlan(
            id = "route", label = "Ruta", date = "2026-09-23", vehicle = "Unidad A",
            plate = "AAA-001", routeStatus = "current", overview = null, orders = emptyList(),
        )
        val photos = listOf(UnitPhoto("photo-1", "2026-09-23T10:00:00Z", "2026-10-08T10:00:00Z"))
        assertEquals(true, canDeleteUnitPhoto(route, photos, "photo-1"))
        assertEquals(false, canDeleteUnitPhoto(route, photos, "photo-other"))
        assertEquals(false, canDeleteUnitPhoto(null, photos, "photo-1"))
        assertEquals(false, canDeleteUnitPhoto(route.copy(startedAt = "2026-09-23T11:00:00Z"), photos, "photo-1"))
    }

    @Test
    fun `new server day resets previous photos and selects todays route without logging out`() {
        val yesterday = AssignedPlan(
            id = "yesterday", label = "Ayer", date = "2026-09-23", vehicle = "Unidad A",
            plate = "AAA-001", routeStatus = "current", overview = null, orders = emptyList(),
            photoCount = 5, startedAt = "2026-09-23T14:00:00Z",
        )
        val today = yesterday.copy(id = "today", date = "2026-09-24", photoCount = 0, startedAt = null)
        val profile = DriverProfile("driver", "Chofer", "3312345678")
        val before = DriverDashboard(profile, "America/Mexico_City", "2026-09-23", listOf(summary("yesterday", "2026-09-23")), yesterday)
        val after = before.copy(serviceDate = "2026-09-24", plans = before.plans + summary("today", "2026-09-24"), today = today)
        val state = DriverUiState(token = "session", dashboard = before, selected = yesterday, showPhotos = true,
            photos = listOf(UnitPhoto("old-photo", "2026-09-23T14:00:00Z", "2026-10-08T14:00:00Z")),
            destination = DriverDestination.ROUTE, orderDetailId = "old-order")
        val next = reconcilePublishedRoutes(state, after)
        assertEquals("session", next.token)
        assertEquals("today", next.selected?.id)
        assertEquals(0, next.selected?.photoCount)
        assertEquals(null, next.selected?.startedAt)
        assertEquals(emptyList<UnitPhoto>(), next.photos)
        assertEquals(false, next.showPhotos)
        assertEquals(null, next.orderDetailId)
        assertEquals(DriverDestination.HOME, next.destination)
        assertEquals(null, reconcilePublishedRoutes(state, after.copy(today = null)).selected)
    }

    @Test
    fun `a newly published route appears automatically and identical refresh does not repeat the notice`() {
        val profile = DriverProfile("driver", "Chofer", "3312345678")
        val empty = DriverDashboard(profile, "America/Mexico_City", "2026-09-23", emptyList(), null)
        val route = AssignedPlan(
            id = "route", label = "Ruta de hoy", date = "2026-09-23", vehicle = "Unidad A",
            plate = "AAA-001", routeStatus = "current", overview = null, orders = emptyList(),
            publicationRevision = 1,
        )
        val published = empty.copy(plans = listOf(summary("route", "2026-09-23").copy(publicationRevision = 1)), today = route)
        val first = reconcilePublishedRoutes(DriverUiState(token = "session", dashboard = empty), published)
        assertEquals("route", first.selected?.id)
        assertEquals("Tienes una ruta nueva o actualizada. Ya aparece en tu jornada.", first.notice)

        val unchanged = reconcilePublishedRoutes(first.copy(notice = ""), published)
        assertEquals("", unchanged.notice)

        val revised = published.copy(plans = listOf(published.plans.single().copy(publicationRevision = 2)),
            today = route.copy(publicationRevision = 2))
        val update = reconcilePublishedRoutes(unchanged, revised)
        assertEquals(2, update.selected?.publicationRevision)
        assertEquals("Tienes una ruta nueva o actualizada. Ya aparece en tu jornada.", update.notice)

        val initialLoad = reconcilePublishedRoutes(DriverUiState(token = "session"), published)
        assertEquals("", initialLoad.notice)
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
