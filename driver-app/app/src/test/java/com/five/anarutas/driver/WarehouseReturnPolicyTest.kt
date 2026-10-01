package com.five.anarutas.driver

import java.time.Instant
import org.junit.Assert.*
import org.junit.Test

class WarehouseReturnPolicyTest {
    private val depot = RouteDeparture("Bodega configurada", 20.65, -103.42, 3)
    private fun stop(id: String, statuses: List<OrderServiceStatus>) = ExecutionStop(id, 1, "Cliente", "Domicilio",
        statuses.indices.map { "$id-order-$it" }, null, 1, 1, false, "2026-09-29T14:00:00Z", 1,
        orderStates = statuses.mapIndexed { i, status -> ExecutionOrderState("$id-order-$i", status, 1) })
    private fun execution(stops: List<ExecutionStop>) = DriverExecution("execution", "plan", 4, 5,
        Instant.parse("2026-09-29T14:00:00Z"), 0, "America/Mexico_City", ArrivalPolicy(100, 50, 30, 1), false, stops)
    private fun route(stops: List<ExecutionStop>) = AssignedPlan("plan", label = "Recorrido", date = "2026-09-29",
        vehicle = "Unidad", plate = "", routeStatus = "current", overview = null,
        orders = stops.flatMap { s -> s.shipmentIds.map { DeliveryOrder(it, it, s.customer, s.address, s.position, null, null, "", emptyList()) } },
        startedAt = "2026-09-29T13:00:00Z", publicationRevision = 4, departure = depot)
    private val delivered = stop("last", listOf(OrderServiceStatus.DELIVERED))

    @Test fun aPricedDeliveryCannotReturnToWarehouseBeforeTheCollectionIsCommitted() {
        val unpaid = delivered.copy(orderStates = delivered.orderStates.map { it.copy(paymentRequired = true, paymentConfirmed = false) })
        val plan = route(listOf(unpaid))
        assertTrue(unpaid.hasPendingCollection())
        assertFalse(unpaid.isServiceFinished())
        assertEquals("Entrega con cobro pendiente", unpaid.serviceSummary())
        assertNull(warehouseReturnDestination(plan, execution(listOf(unpaid))))
        val paid = unpaid.copy(orderStates = unpaid.orderStates.map { it.copy(paymentConfirmed = true) })
        assertFalse(paid.hasPendingCollection())
        assertTrue(paid.isServiceFinished())
        assertNotNull(warehouseReturnDestination(plan, execution(listOf(paid))))
        val rescheduled = unpaid.copy(orderStates = unpaid.orderStates.map { it.copy(status = OrderServiceStatus.RESCHEDULED) })
        assertFalse(rescheduled.hasPendingCollection())
        assertNotNull(warehouseReturnDestination(route(listOf(rescheduled)), execution(listOf(rescheduled))))
    }

    @Test fun allOrdersMustBeTerminalEvenWithoutCoordinatesOrVisibleMarkers() {
        for (a in OrderServiceStatus.entries) for (b in OrderServiceStatus.entries) {
            val stops = listOf(stop("first", listOf(a)), stop("last", listOf(b)))
            assertEquals("$a / $b", listOf(a, b).all { it in listOf(OrderServiceStatus.DELIVERED, OrderServiceStatus.RESCHEDULED) },
                warehouseReturnDestination(route(stops), execution(stops)) != null)
        }
        val stops = listOf(delivered, stop("group", List(8) { OrderServiceStatus.DELIVERED }))
        assertEquals(WarehouseDestination("execution", depot), warehouseReturnDestination(route(stops), execution(stops)))
        for (status in OrderServiceStatus.entries.filter { it !in listOf(OrderServiceStatus.DELIVERED, OrderServiceStatus.RESCHEDULED) }) {
            val mixed = listOf(delivered, stop("group", List(7) { OrderServiceStatus.DELIVERED } + status))
            assertNull(warehouseReturnDestination(route(mixed), execution(mixed)))
        }
    }

    @Test fun emptyMissingDuplicatedAndForeignOrderStatesNeverMeanCompleted() {
        val stops = listOf(delivered)
        val plan = route(stops)
        assertNull(warehouseReturnDestination(plan, execution(emptyList())))
        assertNull(warehouseReturnDestination(route(emptyList()), execution(emptyList())))
        assertNull(warehouseReturnDestination(plan.copy(orders = emptyList()), execution(stops)))
        assertNull(warehouseReturnDestination(plan.copy(orders = plan.orders + plan.orders), execution(stops)))
        assertNull(warehouseReturnDestination(plan.copy(orders = plan.orders.map { it.copy(id = "") }), execution(stops)))
        assertNull(warehouseReturnDestination(plan, execution(stops + stops)))
        assertNull(warehouseReturnDestination(plan, execution(listOf(delivered.copy(shipmentIds = emptyList())))))
        assertNull(warehouseReturnDestination(plan, execution(listOf(delivered.copy(orderStates = emptyList())))))
        assertNull(warehouseReturnDestination(plan, execution(listOf(delivered.copy(orderStates = delivered.orderStates + delivered.orderStates)))))
        assertNull(warehouseReturnDestination(plan, execution(listOf(delivered.copy(orderStates = delivered.orderStates.map { it.copy(shipmentId = "foreign") })))))
        assertNull(warehouseReturnDestination(plan, execution(listOf(delivered.copy(shipmentIds = listOf("foreign"))))))
        val empty = stop("empty", emptyList())
        assertNull(warehouseReturnDestination(plan, execution(stops + empty)))
        val grouped = stop("group", List(2) { OrderServiceStatus.DELIVERED })
        assertNull(warehouseReturnDestination(route(listOf(grouped)), execution(listOf(grouped.copy(orderStates = List(2) { grouped.orderStates[0] })))))
    }

    @Test fun onlyTheSameStartedPublicationCanReturn() {
        val plan = route(listOf(delivered)); val run = execution(listOf(delivered))
        assertNull(warehouseReturnDestination(null, run)); assertNull(warehouseReturnDestination(plan, null))
        assertNull(warehouseReturnDestination(plan.copy(id = "other"), run))
        assertNull(warehouseReturnDestination(plan.copy(publicationRevision = 3), run))
        assertNull(warehouseReturnDestination(plan.copy(publicationRevision = 0), run.copy(publicationRevision = 0)))
        assertNull(warehouseReturnDestination(plan.copy(startedAt = null), run))
        assertNull(warehouseReturnDestination(plan.copy(startedAt = " "), run))
        assertNull(warehouseReturnDestination(plan.copy(completedAt = "2026-09-29T15:00:00Z"), run))
        assertNull(warehouseReturnDestination(plan, run.copy(completedAt = "2026-09-29T15:00:00Z")))
    }

    @Test fun missingOrInvalidOriginNeverCreatesInventedNavigation() {
        val stops = listOf(delivered); val plan = route(stops); val run = execution(stops)
        assertNull(warehouseReturnDestination(plan.copy(departure = null), run))
        for (origin in listOf(depot.copy(address = " "), depot.copy(version = 0), depot.copy(version = -1),
            depot.copy(latitude = Double.NaN), depot.copy(longitude = Double.NaN),
            depot.copy(latitude = Double.POSITIVE_INFINITY), depot.copy(longitude = Double.NEGATIVE_INFINITY),
            depot.copy(latitude = -90.01), depot.copy(latitude = 90.01), depot.copy(longitude = -180.01), depot.copy(longitude = 180.01))) {
            assertNull(warehouseReturnDestination(plan.copy(departure = origin), run))
        }
        for (latitude in listOf(-90.0, 0.0, 90.0)) for (longitude in listOf(-180.0, 0.0, 180.0)) {
            assertNotNull(warehouseReturnDestination(plan.copy(departure = depot.copy(latitude = latitude, longitude = longitude)), run))
        }
    }

    @Test fun changedOriginExecutionOrReopenedOrderInvalidatesLateSdkResults() {
        val plan = route(listOf(delivered)); val run = execution(listOf(delivered))
        val first = warehouseReturnDestination(plan, run)!!
        assertEquals(ExecutionPoint(depot.latitude, depot.longitude), first.point)
        assertEquals("warehouse", first.etaId)
        assertFalse(run.stops.any { it.id == first.etaId })
        assertEquals(GuidanceResultDecision.CURRENT, guidanceResultDecision(1, 1, first.key, first.key, false, false))
        for (next in listOf(warehouseReturnDestination(plan.copy(departure = depot.copy(version = 4)), run),
            warehouseReturnDestination(plan.copy(departure = depot.copy(latitude = 20.66)), run),
            warehouseReturnDestination(plan.copy(departure = depot.copy(longitude = -103.43)), run),
            warehouseReturnDestination(plan, run.copy(id = "another-execution")),
            warehouseReturnDestination(plan, run.copy(stops = listOf(delivered.copy(orderStates = delivered.orderStates.map { it.copy(status = OrderServiceStatus.CLOSED_PENDING) })))))) {
            assertEquals(GuidanceResultDecision.DESTINATION_CHANGED, guidanceResultDecision(1, 1, first.key, next?.key, false, false))
        }
        assertEquals(GuidanceResultDecision.IGNORE, guidanceResultDecision(1, 2, first.key, first.key, false, false))
        assertEquals(GuidanceResultDecision.IGNORE, guidanceResultDecision(1, 1, first.key, first.key, true, false))
        assertEquals(GuidanceResultDecision.IGNORE, guidanceResultDecision(1, 1, first.key, first.key, false, true))
        assertEquals(plan, route(listOf(delivered))); assertEquals(run, execution(listOf(delivered)))
    }
}
