package com.five.anarutas.driver

import org.junit.Assert.*
import org.junit.Test

class DriverServicePolicyTest {
    @Test fun closedBusinessRequiresNewArrivalButOrdinaryArrivalIsReady() {
        assertTrue(serviceVisitReady(true, 1, 0))
        assertFalse(serviceVisitReady(false, 1, 0))
        assertFalse(serviceVisitReady(true, 1, 1))
        assertTrue(serviceVisitReady(true, 2, 1))
    }
    @Test fun rescheduledNeedsExplicitReopenAndCannotBeDeliveredDirectly() {
        for (status in OrderServiceStatus.entries) {
            assertEquals(status in listOf(OrderServiceStatus.OPEN, OrderServiceStatus.CLOSED_PENDING, OrderServiceStatus.REJECTED), canDeliverOrder(status))
            assertEquals(status in listOf(OrderServiceStatus.OPEN, OrderServiceStatus.CLOSED_PENDING), canRejectOrder(status))
            assertEquals(status == OrderServiceStatus.CLOSED_PENDING, canRescheduleOrder(status))
            assertEquals(status == OrderServiceStatus.RESCHEDULED, canRetryRescheduledOrder(status))
            assertEquals(status, OrderServiceStatus.parse(status.wire))
        }
        assertThrows(IllegalStateException::class.java) { OrderServiceStatus.parse("unknown") }
    }
    @Test fun groupedOrdersStayIndependentAndMarkersKeepPendingVisible() {
        val stop = ExecutionStop("stop", 1, "Cliente", "Dirección", listOf("a", "b"), null, 1, 1, false, "arrival", 1,
            orderStates = listOf(ExecutionOrderState("a", OrderServiceStatus.CLOSED_PENDING, 1), ExecutionOrderState("b", OrderServiceStatus.OPEN, 1)))
        assertTrue(stop.hasPendingRetry())
        assertFalse(stop.isServiceFinished())
        assertTrue(stop.canAttend())
        assertFalse(stop.copy(closedReportedVisitSequence = 1).canAttend())
        val done = stop.copy(orderStates = listOf(ExecutionOrderState("a", OrderServiceStatus.DELIVERED, 2), ExecutionOrderState("b", OrderServiceStatus.RESCHEDULED, 2)))
        assertFalse(done.hasPendingRetry())
        assertTrue(done.isServiceFinished())
        assertFalse(done.canAttend())
        assertFalse(stop.copy(orderStates = emptyList()).isServiceFinished())
        val pending = routeMarkerStyle(false, false, true)
        assertNotNull(pending.outline)
        assertNotEquals(pending, routeMarkerStyle(false, false))
        for (selected in listOf(false, true)) for (arrived in listOf(false, true)) {
            assertEquals("#F59E42", routeMarkerStyle(selected, arrived, true).fill)
            assertEquals("#261505", routeMarkerStyle(selected, arrived, true).text)
            assertEquals(if (selected) "#FFF4DE" else "#FFD498", routeMarkerStyle(selected, arrived, true).outline)
        }
    }
    @Test fun mapHidesOnlyFullyFinishedStopsAndReopeningRestoresThemWithoutLosingListEntries() {
        val original = ExecutionStop("stop", 1, "Cliente", "Dirección", listOf("a", "b"), ExecutionPoint(20.64, -103.4), 1, 1, false, null, 0,
            orderStates = listOf(ExecutionOrderState("a", OrderServiceStatus.OPEN, 1), ExecutionOrderState("b", OrderServiceStatus.OPEN, 1)))
        for (first in OrderServiceStatus.entries) for (second in OrderServiceStatus.entries) {
            val stop = original.copy(orderStates = listOf(ExecutionOrderState("a", first, 2), ExecutionOrderState("b", second, 2)))
            val finished = listOf(first, second).all { it in listOf(OrderServiceStatus.DELIVERED, OrderServiceStatus.RESCHEDULED) }
            assertEquals(!finished, stop.isVisibleOnMap())
            assertFalse(stop.copy(point = null).isVisibleOnMap())
        }
        val terminal = original.copy(orderStates = original.orderStates.map { it.copy(status = OrderServiceStatus.RESCHEDULED) })
        val stops = listOf(original, terminal)
        assertEquals(2, stops.size)
        assertEquals(listOf(original), stops.filter { it.isVisibleOnMap() })
        val reopened = terminal.copy(arrivedAt = null, orderStates = listOf(original.orderStates[0], terminal.orderStates[1]))
        assertTrue(reopened.isVisibleOnMap())
        assertFalse(reopened.canAttend())
        assertTrue(original.copy(orderStates = emptyList()).isVisibleOnMap())
        assertEquals("Reprogramada · puedes reintentar desde Pedido", terminal.serviceSummary())
        assertEquals("Entregada · fuera del mapa", terminal.copy(orderStates = terminal.orderStates.map { it.copy(status = OrderServiceStatus.DELIVERED) }).serviceSummary())
        assertEquals("Cliente cerrado · pendiente de reintento", original.copy(orderStates = listOf(original.orderStates[0].copy(status = OrderServiceStatus.CLOSED_PENDING))).serviceSummary())
        assertEquals("Llegada registrada", original.copy(arrivedAt = "arrival").serviceSummary())
        assertEquals("Dirección", original.serviceSummary())
    }
}
