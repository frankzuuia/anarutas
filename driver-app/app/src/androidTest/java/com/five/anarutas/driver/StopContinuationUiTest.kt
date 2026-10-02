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

    @Test fun retriesOfferManualChoiceAndNeverWarehouseOrAutomaticNavigation() {
        var choices = 0
        var navigation = 0
        val retry = next.copy(orderStates = listOf(ExecutionOrderState("order", OrderServiceStatus.CLOSED_PENDING, 2)))
        val warehouse = WarehouseDestination("execution", RouteDeparture("Bodega", 20.65, -103.42, 1))
        compose.setContent { DriverTheme {
            StopContinuationSheet(StopCompletion.DELIVERED, null, true, { navigation++ }, {}, warehouse, true, { navigation++ },
                retries = listOf(retry), canChooseRetry = true, onChooseRetry = { choices++ })
        } }
        compose.onNodeWithText("REINTENTOS PENDIENTES").assertIsDisplayed()
        compose.onNodeWithText("Tienes reintentos que realizar", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Ir a bodega").assertDoesNotExist()
        compose.onNodeWithText("Ir a la siguiente parada").assertDoesNotExist()
        compose.runOnIdle { assertEquals(0, navigation); assertEquals(0, choices) }
        compose.onNodeWithText("Elegir reintento").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(1, choices); assertEquals(0, navigation) }
    }

    @Test fun normalNextStopPrecedesRetriesAndRetryChoiceWaitsForVerifiedRoute() {
        var normal by mutableStateOf<ExecutionStop?>(next)
        var ready by mutableStateOf(false)
        var choices = 0
        val retry = next.copy(orderStates = listOf(ExecutionOrderState("order", OrderServiceStatus.CLOSED_PENDING, 2)))
        compose.setContent { DriverTheme {
            StopContinuationSheet(StopCompletion.CUSTOMER_CLOSED, normal, true, {}, {}, retries = listOf(retry),
                canChooseRetry = ready, onChooseRetry = { choices++ })
        } }
        compose.onNodeWithText("Ir a la siguiente parada").performScrollTo().assertIsEnabled()
        compose.onNodeWithText("Elegir reintento").assertDoesNotExist()
        compose.runOnIdle { normal = null }
        compose.onNodeWithText("Elegir reintento").performScrollTo().assertIsNotEnabled()
        compose.runOnIdle { assertEquals(0, choices); ready = true }
        compose.onNodeWithText("Elegir reintento").assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(1, choices) }
    }
}
