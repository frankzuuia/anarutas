package com.five.anarutas.driver

import org.junit.Assert.*
import org.junit.Test

class RemoteReschedulePolicyTest {
    @Test fun remoteRescheduleNeedsRealClosedHistoryAndCurrentVisitIdentity() {
        for (status in OrderServiceStatus.entries) for (visit in listOf(-1, 0, 1, 2, 3)) for (closed in listOf(-1, 0, 1, 2, 3)) {
            assertEquals("$status / $visit / $closed", status == OrderServiceStatus.CLOSED_PENDING && closed > 0 && visit >= closed,
                canRescheduleRetry(status, visit, closed))
        }
    }
}
