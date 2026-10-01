package com.five.anarutas.driver

import org.junit.Assert.*
import org.junit.Test

class DriverBackPolicyTest {
    @Test fun financeDetailReturnsToItsOwnRoutesIncludingWhileDetailIsLoading() {
        assertEquals(DriverBackTarget.FINANCE_ROUTES, driverBackTarget(false, DriverDestination.FINANCE, "selected-execution"))
    }
    @Test fun openDrawerClosesBeforeAnyNavigation() {
        DriverDestination.entries.forEach { destination ->
            listOf(null, "selected-execution").forEach { execution ->
                assertEquals(DriverBackTarget.DRAWER, driverBackTarget(true, destination, execution))
            }
        }
    }
    @Test fun financeListReturnsHomeOnTheNextBack() {
        assertEquals(DriverBackTarget.HOME, driverBackTarget(false, DriverDestination.FINANCE, null))
    }
    @Test fun retainedFinanceSelectionDoesNotOverrideOtherTabs() {
        DriverDestination.entries.filter { it != DriverDestination.FINANCE }.forEach { destination ->
            listOf(null, "selected-execution").forEach { execution ->
                assertEquals(DriverBackTarget.HOME, driverBackTarget(false, destination, execution))
            }
        }
    }
}
