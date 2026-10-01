package com.five.anarutas.driver

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DriverSettlementPolicyTest {
    @Test fun temporaryModeShowsRouteActionsBeforeTheWarehouse() {
        assertTrue(routeLiquidationActionsVisible(false, false, true))
        assertTrue(routeLiquidationActionsVisible(true, false, true))
    }
    @Test fun restoringWarehouseRequirementHidesUnfinishedRouteActions() {
        assertFalse(routeLiquidationActionsVisible(false, true, true))
        assertTrue(routeLiquidationActionsVisible(true, true, true))
    }
    @Test fun noReceiptsNeverShowsRouteSettlementActions() {
        assertFalse(routeLiquidationActionsVisible(false, false, false))
        assertFalse(routeLiquidationActionsVisible(false, true, false))
        assertFalse(routeLiquidationActionsVisible(true, false, false))
        assertFalse(routeLiquidationActionsVisible(true, true, false))
    }
}
