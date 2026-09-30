package com.five.anarutas.driver

import androidx.activity.ComponentActivity
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Production presentation component, no mocked API, Navigator or location provider. */
@RunWith(AndroidJUnit4::class)
class StopContinuationUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val next = ExecutionStop("next", 2, "Siguiente cliente", "Domicilio", listOf("order"),
        ExecutionPoint(20.64, -103.4), 1, 1, false, null, 0,
        orderStates = listOf(ExecutionOrderState("order", OrderServiceStatus.OPEN, 1)))

    @Test fun closeDoesNotNavigateAndConsumedDialogStaysClosedOnRecomposition() {
        var open by mutableStateOf(true)
        var navigation = 0
        compose.setContent { DriverTheme {
            if (open) StopContinuationSheet(StopCompletion.DELIVERED, next, true, { navigation++ }, { open = false })
        } }
        compose.onNodeWithText("Entrega confirmada").assertIsDisplayed()
        compose.onNodeWithText("Cerrar").performScrollTo().performClick()
        compose.onNodeWithText("Ir a la siguiente parada").assertDoesNotExist()
        compose.runOnIdle { assertEquals(0, navigation) }
    }

    @Test fun closedIncidentRequiresExplicitActionAndWaitsForNavigationReadiness() {
        var ready by mutableStateOf(false)
        var navigation = 0
        compose.setContent { DriverTheme {
            StopContinuationSheet(StopCompletion.CUSTOMER_CLOSED, next, ready, { navigation++ }, {})
        } }
        compose.onNodeWithText("Cliente cerrado registrado").assertIsDisplayed()
        compose.onNodeWithText("Ir a la siguiente parada").performScrollTo().assertIsNotEnabled()
        compose.runOnIdle { assertEquals(0, navigation); ready = true }
        compose.onNodeWithText("Ir a la siguiente parada").assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(1, navigation) }
    }

    @Test fun noNextStopOffersCloseWithoutInventingNavigationOrRouteClosure() {
        compose.setContent { DriverTheme { StopContinuationSheet(StopCompletion.DELIVERED, null, false, {}, {}) } }
        compose.onNodeWithText("Ir a la siguiente parada").assertDoesNotExist()
        compose.onNodeWithText("Cerrar").performScrollTo().assertIsEnabled()
        compose.onNodeWithText("No hay otra parada pendiente", substring = true).assertIsDisplayed()
    }

    @Test fun lastDeliveryOffersWarehouseOnlyAfterExplicitActionAndReadiness() {
        var ready by mutableStateOf(false)
        var returns = 0
        val warehouse = WarehouseDestination("execution", RouteDeparture("Punto de salida real", 20.65, -103.42, 1))
        compose.setContent { DriverTheme {
            StopContinuationSheet(StopCompletion.DELIVERED, null, false, {}, {}, warehouse, ready, { returns++ })
        } }
        compose.onNodeWithText("REGRESO A BODEGA").assertIsDisplayed()
        compose.onNodeWithText("Punto de salida real").assertIsDisplayed()
        compose.onNodeWithText("Ir a la siguiente parada").assertDoesNotExist()
        compose.onNodeWithText("Ir a bodega").performScrollTo().assertIsNotEnabled()
        compose.runOnIdle { assertEquals(0, returns); ready = true }
        compose.onNodeWithText("Ir a bodega").assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(1, returns) }
    }

    @Test fun pendingNextStopAlwaysTakesPriorityOverWarehouse() {
        val warehouse = WarehouseDestination("execution", RouteDeparture("Bodega", 20.65, -103.42, 1))
        compose.setContent { DriverTheme {
            StopContinuationSheet(StopCompletion.DELIVERED, next, true, {}, {}, warehouse, true, {})
        } }
        compose.onNodeWithText("Ir a bodega").assertDoesNotExist()
        compose.onNodeWithText("Ir a la siguiente parada").performScrollTo().assertIsEnabled()
    }

    @Test fun closedCustomerNeverSuggestsWarehouseEvenWithAnUnexpectedOriginArgument() {
        val warehouse = WarehouseDestination("execution", RouteDeparture("Bodega", 20.65, -103.42, 1))
        compose.setContent { DriverTheme {
            StopContinuationSheet(StopCompletion.CUSTOMER_CLOSED, null, false, {}, {}, warehouse, true, {})
        } }
        compose.onNodeWithText("Ir a bodega").assertDoesNotExist()
        compose.onNodeWithText("Esta parada sigue pendiente", substring = true).assertIsDisplayed()
    }
}
