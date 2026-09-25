package com.five.anarutas.driver

import org.junit.Assert.assertEquals
import org.junit.Test

class GuidanceResultPolicyTest {
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
