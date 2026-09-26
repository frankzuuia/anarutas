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
    @Test fun rejectedCanBeDeliveredButRescheduledCannotBeReopened() {
        for (status in OrderServiceStatus.entries) {
            assertEquals(status in listOf(OrderServiceStatus.OPEN, OrderServiceStatus.CLOSED_PENDING, OrderServiceStatus.REJECTED), canDeliverOrder(status))
            assertEquals(status in listOf(OrderServiceStatus.OPEN, OrderServiceStatus.CLOSED_PENDING), canRejectOrder(status))
            assertEquals(status == OrderServiceStatus.CLOSED_PENDING, canRescheduleOrder(status))
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
        assertEquals(routeMarkerStyle(true, false), routeMarkerStyle(true, true, true))
    }
}
