package com.five.anarutas.driver

import org.junit.Assert.*
import org.junit.Test

class StopContinuationPolicyTest {
    private fun stop(position: Int, vararg status: OrderServiceStatus) = ExecutionStop(
        "stop-$position", position, "Cliente $position", "Domicilio", status.indices.map { "order-$it" },
        ExecutionPoint(20.64, -103.4), 1, 1, false, null, 1,
        orderStates = status.mapIndexed { i, value -> ExecutionOrderState("order-$i", value, 1) })

    @Test fun deliveryPromptsOnlyWhenEveryOrderAtTheStopIsTerminal() {
        for (first in OrderServiceStatus.entries) for (second in OrderServiceStatus.entries) {
            val item = stop(1, first, second)
            val result = confirmedStopContinuation("receipt", "service", "deliver", item)
            val finished = listOf(first, second).all { it == OrderServiceStatus.DELIVERED || it == OrderServiceStatus.RESCHEDULED }
            assertEquals(finished, result != null)
            if (finished) assertEquals(StopContinuation("receipt", item.id, StopCompletion.DELIVERED), result)
        }
        assertNull(confirmedStopContinuation("receipt", "service", "deliver", stop(1)))
    }

    @Test fun closedPromptsOnlyWithPendingStateAndKeepsCommandIdentity() {
        for (status in OrderServiceStatus.entries) {
            val result = confirmedStopContinuation("closed-receipt", "closed", null, stop(3, status))
            if (status == OrderServiceStatus.CLOSED_PENDING)
                assertEquals(StopContinuation("closed-receipt", "stop-3", StopCompletion.CUSTOMER_CLOSED), result)
            else assertNull(result)
        }
    }

    @Test fun unrelatedCommandsAndMissingStopsNeverPrompt() {
        for (kind in listOf("arrival", "visit-exit", "order-retry", "phone", "location")) {
            assertNull(confirmedStopContinuation("id", kind, "deliver", stop(1, OrderServiceStatus.DELIVERED)))
            assertNull(confirmedStopContinuation("id", kind, null, stop(1, OrderServiceStatus.CLOSED_PENDING)))
        }
        for (kind in listOf("reject", null))
            assertNull(confirmedStopContinuation("id", "service", kind, stop(1, OrderServiceStatus.DELIVERED)))
        assertEquals(StopCompletion.RESCHEDULED,
            confirmedStopContinuation("id", "service", "reschedule", stop(1, OrderServiceStatus.RESCHEDULED))?.completion)
        assertNull(confirmedStopContinuation("id", "service", "reschedule", stop(1, OrderServiceStatus.CLOSED_PENDING)))
        assertNull(confirmedStopContinuation("id", "closed", null, null))
        assertNull(confirmedStopContinuation("id", "service", "deliver", null))
    }

    @Test fun nextUsesPublishedPositionNotInputOrderAndSkipsTerminalMissingOrUnknownStops() {
        val from = stop(2, OrderServiceStatus.DELIVERED)
        val next = stop(6, OrderServiceStatus.OPEN, OrderServiceStatus.DELIVERED)
        val candidates = listOf(stop(9, OrderServiceStatus.OPEN), next, stop(1, OrderServiceStatus.OPEN), from,
            stop(3, OrderServiceStatus.RESCHEDULED), stop(4, OrderServiceStatus.OPEN).copy(point = null), stop(5))
        assertEquals(next, nextPendingStop(candidates, from.id))
        assertNull(nextPendingStop(candidates, "removed"))
        assertNull(nextPendingStop(emptyList(), from.id))
    }

    @Test fun endOfRouteWrapsToEarlierPendingButNeverTheCompletedOrClosedStopItself() {
        val first = stop(1, OrderServiceStatus.OPEN)
        val rejected = stop(2, OrderServiceStatus.REJECTED)
        val last = stop(4, OrderServiceStatus.CLOSED_PENDING)
        assertEquals(first, nextPendingStop(listOf(last, rejected, first), last.id))
        assertEquals(rejected, nextPendingStop(listOf(first, rejected, last), first.id))
        assertNull(nextPendingStop(listOf(last), last.id))
        assertNull(nextPendingStop(listOf(last, first.copy(orderStates = listOf(ExecutionOrderState("a", OrderServiceStatus.DELIVERED, 2)))), last.id))
    }

    @Test fun refreshedTerminalCandidateIsNotReusedAndLookupDoesNotMutateStops() {
        val from = stop(1, OrderServiceStatus.DELIVERED)
        val second = stop(2, OrderServiceStatus.OPEN)
        val third = stop(3, OrderServiceStatus.OPEN)
        val stops = listOf(from, second, third)
        assertEquals(second, nextPendingStop(stops, from.id))
        val updated = stops.map { if (it == second) stop(2, OrderServiceStatus.RESCHEDULED) else it }
        assertEquals(third, nextPendingStop(updated, from.id))
        assertEquals(OrderServiceStatus.OPEN, stops[1].orderStates[0].status)
        assertNull(stops[1].arrivedAt)
    }

    @Test fun completedThirdStopIsSkippedAfterSecondAndEarlierNormalStopsAreNotForgotten() {
        val first = stop(1, OrderServiceStatus.OPEN)
        val second = stop(2, OrderServiceStatus.DELIVERED)
        val third = stop(3, OrderServiceStatus.DELIVERED)
        val fourth = stop(4, OrderServiceStatus.OPEN)
        assertEquals(fourth, nextPendingStop(listOf(fourth, third, first, second), second.id))
        assertEquals(first, nextPendingStop(listOf(second, third, fourth.copy(orderStates = listOf(ExecutionOrderState("4", OrderServiceStatus.DELIVERED, 2))), first), fourth.id))
    }

    @Test fun retriesAreNeverSuggestedAutomaticallyAndRemainInTheManualMenuIncludingCurrentStop() {
        val retry = stop(1, OrderServiceStatus.CLOSED_PENDING)
        val current = stop(4, OrderServiceStatus.CLOSED_PENDING).copy(point = null)
        val completed = stop(2, OrderServiceStatus.DELIVERED)
        val rescheduled = stop(3, OrderServiceStatus.RESCHEDULED)
        val stops = listOf(current, rescheduled, completed, retry)
        assertNull(nextPendingStop(stops, completed.id))
        assertEquals(listOf(retry, current), pendingRetryStops(stops))
        assertEquals(listOf(current), pendingRetryStops(listOf(current)))
        assertTrue(pendingRetryStops(listOf(completed, rescheduled)).isEmpty())
        assertTrue(pendingRetryStops(emptyList()).isEmpty())
    }

    @Test fun remainingOpenOrderAtMixedStopStillBelongsToNormalRecorrido() {
        val from = stop(1, OrderServiceStatus.DELIVERED)
        val mixed = stop(2, OrderServiceStatus.CLOSED_PENDING, OrderServiceStatus.OPEN)
        assertEquals(mixed, nextPendingStop(listOf(from, mixed), from.id))
        assertEquals(listOf(mixed), pendingRetryStops(listOf(from, mixed)))
    }

    @Test fun deliveryContinuationWaitsForAllRequiredPayments() {
        val delivered = stop(1, OrderServiceStatus.DELIVERED)
        val unpaid = delivered.copy(orderStates = delivered.orderStates.map { it.copy(paymentRequired = true, paymentConfirmed = false) })
        assertNull(confirmedStopContinuation("receipt", "service", "deliver", unpaid))
        val paid = unpaid.copy(orderStates = unpaid.orderStates.map { it.copy(paymentConfirmed = true) })
        assertEquals(StopCompletion.DELIVERED, confirmedStopContinuation("receipt", "service", "deliver", paid)?.completion)
    }

    @Test fun deliveredOrderWithPendingCollectionDoesNotInventAnotherDeliveryDestination() {
        val from = stop(1, OrderServiceStatus.DELIVERED)
        val unpaid = stop(2, OrderServiceStatus.DELIVERED).let { item ->
            item.copy(orderStates = item.orderStates.map { it.copy(paymentRequired = true, paymentConfirmed = false) })
        }
        assertTrue(unpaid.isVisibleOnMap())
        assertNull(nextPendingStop(listOf(from, unpaid), from.id))
        val normal = stop(3, OrderServiceStatus.OPEN)
        assertEquals(normal, nextPendingStop(listOf(from, unpaid, normal), from.id))
    }

    @Test fun previewNeverOverlapsCalculatingRestoredOrActiveGuidanceAndNeverUsesCorrectedGeometry() {
        for (guiding in listOf(false, true)) for (calculating in listOf(false, true))
            for (sdkGuiding in listOf(false, true)) for (corrected in listOf(false, true)) {
                assertEquals(listOf(guiding, calculating, sdkGuiding, corrected).none { it },
                    showPublishedPreview(guiding, calculating, sdkGuiding, corrected))
            }
    }
}
