package com.five.anarutas.driver

import org.junit.Assert.*
import org.junit.Test

class TrackingDestinationPolicyTest {
    private val warehouse = WarehouseDestination("execution", RouteDeparture("Bodega", 20.64, -103.4, 3))
    private fun destination(navigating: Boolean = false, guiding: Boolean = false, requested: String? = null, active: String? = null,
        candidate: WarehouseDestination? = warehouse, stop: String? = null) =
        trackingNavigationDestination(candidate, stop, navigating, guiding, requested, active)

    @Test fun onlyTheCurrentlyRequestedOrGuidedWarehouseIsReported() {
        assertEquals(TrackingDestination(depotVersion = 3), destination(navigating = true, requested = warehouse.key))
        assertEquals(TrackingDestination(depotVersion = 3), destination(guiding = true, active = warehouse.key))
        assertEquals(TrackingDestination(depotVersion = 3), destination(navigating = true, guiding = true, requested = warehouse.key, active = "old"))
        assertEquals(TrackingDestination(), destination(requested = warehouse.key, active = warehouse.key))
        assertEquals(TrackingDestination(), destination(navigating = true, active = warehouse.key))
        assertEquals(TrackingDestination(), destination(guiding = true, requested = warehouse.key))
        assertEquals(TrackingDestination(), destination(navigating = true, requested = "old"))
        assertEquals(TrackingDestination(), destination(guiding = true, active = "old"))
    }
    @Test fun retiredOriginOrMissingEligibilityCannotReplayTheOldWarehouseKey() {
        val next = warehouse.copy(departure = warehouse.departure.copy(version = 4))
        assertEquals(TrackingDestination(), destination(candidate = null, navigating = true, requested = warehouse.key))
        assertEquals(TrackingDestination(), destination(candidate = next, guiding = true, active = warehouse.key))
        assertEquals(TrackingDestination(depotVersion = 4), destination(candidate = next, guiding = true, active = next.key))
    }
    @Test fun customerStopsKeepTheirExistingIdentityAndWarehouseNeverBecomesAStop() {
        val customer = destination(candidate = null, stop = "customer")
        assertEquals("customer", customer.stopId); assertEquals("customer", customer.etaId); assertNull(customer.depotVersion)
        val depot = destination(guiding = true, active = warehouse.key, stop = "old-customer")
        assertNull(depot.stopId); assertEquals(warehouse.etaId, depot.etaId); assertEquals(3, depot.depotVersion)
        assertNull(TrackingDestination().etaId)
    }
    @Test fun intentRestorationRequiresAnExclusivePositiveWarehouseVersion() {
        for (version in listOf(1, 3, Int.MAX_VALUE)) assertEquals(TrackingDestination(depotVersion = version), trackingIntentDestination(null, version))
        for (version in listOf(0, -1, Int.MIN_VALUE)) assertEquals(TrackingDestination(), trackingIntentDestination(null, version))
        assertEquals(TrackingDestination(stopId = "customer"), trackingIntentDestination("customer", 3))
        assertEquals(TrackingDestination(stopId = "customer"), trackingIntentDestination("customer", 0))
    }
    @Test fun rejectedWarehouseMetadataDoesNotStopGpsOrRelaxSessionRevocation() {
        val depot = TrackingDestination(depotVersion = 3)
        assertEquals(TrackingDestination(), trackingEffectiveDestination(depot, 3))
        assertEquals(depot, trackingEffectiveDestination(depot, null))
        assertEquals(depot, trackingEffectiveDestination(depot, 4))
        val stop = TrackingDestination(stopId = "customer")
        assertEquals(stop, trackingEffectiveDestination(stop, null))
        assertEquals(stop, trackingEffectiveDestination(stop, 3))
        for (code in listOf("ROUTING_ORIGIN_REQUIRED", "ROUTING_ORIGIN_CHANGED", "ROUTE_HAS_PENDING_ORDERS")) {
            assertTrue(trackingRejectsWarehouse(409, code))
            for (status in listOf(200, 400, 401, 403, 404, 500)) assertFalse(trackingRejectsWarehouse(status, code))
        }
        for (code in listOf("TRACKING_SESSION_CHANGED", "ROUTE_COMPLETED", "NOT_FOUND", "INVALID_TRACKING_ETA", "unknown"))
            assertFalse(trackingRejectsWarehouse(409, code))
    }
    @Test fun closingAnInactiveNavigatorCannotLeaveFreshWarehouseHeartbeats() {
        val depot = TrackingDestination(depotVersion = 3)
        val ready = NavigationEta("warehouse", "ready", 60)
        assertEquals(depot, trackingObservedDestination(depot, ready, true))
        assertEquals(depot, trackingObservedDestination(depot, ready.copy(state = "calculating", remainingSeconds = null), false))
        assertEquals(depot, trackingObservedDestination(depot, ready.copy(state = "unavailable", remainingSeconds = null), true))
        assertEquals(TrackingDestination(), trackingObservedDestination(depot, ready, false))
        assertEquals(TrackingDestination(), trackingObservedDestination(depot, ready.copy(state = "unavailable", remainingSeconds = null), false))
        assertEquals(TrackingDestination(), trackingObservedDestination(depot, null, true))
        assertEquals(TrackingDestination(), trackingObservedDestination(depot, ready.copy(targetStopId = "customer"), true))
        val stop = TrackingDestination(stopId = "customer")
        assertEquals(stop, trackingObservedDestination(stop, null, false))
        assertEquals(stop, trackingObservedDestination(stop, ready, false))
    }
}
