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

@RunWith(AndroidJUnit4::class)
class WarehouseFinishUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    @Test fun cancelNeverFinishesAndConfirmationWaitsForFreshGps() {
        var ready by mutableStateOf(false)
        var confirmed = 0
        var canceled = 0
        compose.setContent { DriverTheme { WarehouseFinishDialog("Bodega configurada", ready, false, { confirmed++ }, { canceled++ }) } }
        compose.onNodeWithText("¿Estás seguro de que terminaste tu ruta?").assertIsDisplayed()
        compose.onNodeWithText("Aceptar").assertIsNotEnabled()
        compose.onNodeWithText("Cancelar").performClick()
        compose.runOnIdle { assertEquals(0, confirmed); assertEquals(1, canceled); ready = true }
        compose.onNodeWithText("Aceptar").assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(1, confirmed) }
    }
    @Test fun pendingConfirmationDisablesBothActions() {
        compose.setContent { DriverTheme { WarehouseFinishDialog("Bodega", true, true, {}, {}) } }
        compose.onNodeWithText("Aceptar").assertIsNotEnabled()
        compose.onNodeWithText("Cancelar").assertIsNotEnabled()
    }
}
