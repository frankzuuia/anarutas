package com.five.anarutas.driver

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GuidanceResultPolicyTest {
    @Test fun explicitNavigationRequiresAReadyOwnRouteAndDifferentDestination() {
        val ready = NavigationActionState(true, false, false, false, false, false, false, true,
            ExecutionPoint(20.64, -103.4), false)
        assertTrue(navigationActionAllowed(ready))
        assertFalse(navigationActionAllowed(ready.copy(alreadyGuidingToDestination = true)))
        assertFalse(navigationActionAllowed(ready.copy(destination = null)))
        assertFalse(navigationActionAllowed(ready.copy(verified = false)))
        assertFalse(navigationActionAllowed(ready.copy(pending = true)))
        assertFalse(navigationActionAllowed(ready.copy(busy = true)))
        assertFalse(navigationActionAllowed(ready.copy(retired = true)))
        assertFalse(navigationActionAllowed(ready.copy(editing = true)))
        assertFalse(navigationActionAllowed(ready.copy(navigating = true)))
        assertFalse(navigationActionAllowed(ready.copy(noticeRequired = true)))
        assertFalse(navigationActionAllowed(ready.copy(navigatorReady = false)))
    }
    @Test fun onlyTheCurrentLiveDestinationCanStartGuidance() {
        assertEquals(GuidanceResultDecision.CURRENT, guidanceResultDecision(7, 7, "point-a", "point-a", false, false))
        assertEquals(GuidanceResultDecision.DESTINATION_CHANGED, guidanceResultDecision(7, 7, "point-a", "point-b", false, false))
        assertEquals(GuidanceResultDecision.DESTINATION_CHANGED, guidanceResultDecision(7, 7, "point-a", null, false, false))
    }
    @Test fun retiredDestroyedAndReplacedRequestsCannotClearOrRestartNewGuidance() {
        assertEquals(GuidanceResultDecision.IGNORE, guidanceResultDecision(7, 7, "point-a", "point-a", true, false))
        assertEquals(GuidanceResultDecision.IGNORE, guidanceResultDecision(7, 7, "point-a", "point-a", false, true))
        assertEquals(GuidanceResultDecision.IGNORE, guidanceResultDecision(7, 8, "point-a", "point-b", false, false))
        assertEquals(GuidanceResultDecision.IGNORE, guidanceResultDecision(7, 7, "point-a", null, true, true))
    }
}
