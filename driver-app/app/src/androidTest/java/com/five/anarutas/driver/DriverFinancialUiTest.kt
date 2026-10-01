package com.five.anarutas.driver

import androidx.activity.ComponentActivity
import androidx.compose.runtime.*
import androidx.compose.material3.Text
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.time.Instant
import org.json.JSONObject
import org.junit.Assert.*

/** Real Compose rendering and semantics; these domain values do not substitute a provider. */
@RunWith(AndroidJUnit4::class)
class DriverFinancialUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    @Test fun liquidationReadsTheActualAndroidJsonContract() {
        val order = JSONObject().put("status", "open").put("payment", JSONObject.NULL)
        assertFalse(liquidationOrderVisible(order))
        order.put("status", "delivered")
        assertFalse(liquidationOrderVisible(order))
        order.put("payment", JSONObject().put("id", "confirmed"))
        assertTrue(liquidationOrderVisible(order))
        order.put("status", "open")
        assertFalse(liquidationOrderVisible(order))
    }
    @Test fun summaryUpdatesItsAmountsAndShowsUnpricedIncidents() {
        val instant = Instant.now()
        var view by mutableStateOf(DriverFinancialView(1, "ready", true, null, instant, instant,
            180, System.nanoTime(), DriverCurrency("MXN", 2), emptyList(), emptyList(), 1,
            DriverFinancialTotals("51.2", "10", "0", "41.2", "0", "0")))
        compose.setContent { DriverTheme {
            ServiceFormSurface({}, header = { Text("Pedido") }, footer = {}) { FinancialOrderSummary(view) }
        } }
        compose.onNodeWithText("$41.20 MXN").performScrollTo().assertIsDisplayed()
        compose.runOnIdle { view = view.copy(revision = 2, totals = view.totals!!.copy(deferred = "5", net = "36.2")) }
        compose.onNodeWithText("$36.20 MXN").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("$41.20 MXN").assertDoesNotExist()
        compose.onNodeWithText("1 faltante(s) sin partida asociada · sin descuento automático").performScrollTo().assertIsDisplayed()
    }
    @Test fun replacementChoiceStartsEmptyAndRequiresAnExplicitSelection() {
        var payment by mutableStateOf("")
        compose.setContent { DriverTheme {
            ProductSelectField("Pago de la reposición", payment,
                listOf("pay_full" to "El cliente paga completo", "defer" to "Deja pendiente el importe de la reposición"), true) { payment = it }
        } }
        compose.runOnIdle { org.junit.Assert.assertEquals("", payment) }
        compose.onNodeWithText("Pago de la reposición").performClick()
        compose.onNodeWithText("El cliente paga completo").performClick()
        compose.runOnIdle { org.junit.Assert.assertEquals("pay_full", payment) }
    }
}
