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
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp

/** Real Compose rendering and semantics; these domain values do not substitute a provider. */
@RunWith(AndroidJUnit4::class)
class DriverFinancialUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    @Test fun refreshControlShowsProgressAndPreventsDuplicateTaps() {
        var loading by mutableStateOf(false)
        var refreshes = 0
        compose.setContent { DriverTheme { FinanceRefreshButton(loading, true) { refreshes++; loading = true } } }
        compose.onNodeWithContentDescription("Actualizar liquidación").assertIsEnabled().assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp).performClick()
        compose.onNodeWithContentDescription("Actualizar liquidación").assertIsNotEnabled()
            .assert(SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.StateDescription, "Actualizando liquidación"))
        compose.onNode(hasProgressBarRangeInfo(androidx.compose.ui.semantics.ProgressBarRangeInfo.Indeterminate)).assertIsDisplayed()
        compose.runOnIdle { assertEquals(1, refreshes); loading = false }
        compose.onNodeWithContentDescription("Actualizar liquidación").assertIsEnabled()
    }
    @Test fun compactCardsKeepActionsSideBySideAndReturnIsAnOutlinedButton() {
        var opened = 0
        var liquidated = 0
        var returned = 0
        compose.setContent { DriverTheme { Column(Modifier.width(320.dp)) {
            FinanceBackButton(true) { returned++ }
            CompactFinanceOrderCard("ABARROTES FRANCO", "S00096", "Sin liquidar", "cash", "$321.19 MXN", null, true, { opened++ }, { liquidated++ })
        } } }
        val open = compose.onNodeWithText("Ver pedido y cobro").assertIsDisplayed()
        val liquidate = compose.onNodeWithText("Liquidar").assertIsDisplayed()
        val openBounds = open.fetchSemanticsNode().boundsInRoot
        val liquidateBounds = liquidate.fetchSemanticsNode().boundsInRoot
        assertEquals(openBounds.center.y, liquidateBounds.center.y, 2f)
        assertTrue(openBounds.right <= liquidateBounds.left)
        open.performClick(); liquidate.performClick()
        compose.onNodeWithText("Volver a mis rutas").assertHasClickAction().performClick()
        compose.runOnIdle { assertEquals(1, opened); assertEquals(1, liquidated); assertEquals(1, returned) }
    }
    @Test fun compactCardsGrowForLargeFontsInsteadOfTruncatingAmountsOrNames() {
        compose.setContent { DriverTheme { CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, 1.5f)) {
            Column(Modifier.width(320.dp)) {
                CompactFinanceOrderCard("ABARROTES FRANCO SUCURSAL PRINCIPAL", "S00096", "Sin liquidar", "mixed", "$1,318.06 MXN",
                    "Efectivo: $321.19 MXN · Transferencia: $996.87 MXN", true, {}, {})
            }
        } } }
        compose.onNodeWithText("ABARROTES FRANCO SUCURSAL PRINCIPAL").assertIsDisplayed()
        compose.onNodeWithText("$1,318.06 MXN").assertIsDisplayed()
        compose.onNodeWithText("Ver pedido y cobro").assertIsDisplayed()
        compose.onNodeWithText("Liquidar").assertIsDisplayed()
    }
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
