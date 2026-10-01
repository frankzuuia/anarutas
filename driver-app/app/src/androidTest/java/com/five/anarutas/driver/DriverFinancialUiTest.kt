package com.five.anarutas.driver

import androidx.activity.ComponentActivity
import androidx.compose.runtime.*
import androidx.compose.material3.Text
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
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
    @Test fun workSummaryShowsRealCountsAndExactTotalsInEveryCurrency() {
        compose.setContent { DriverTheme { Column(Modifier.width(320.dp)) {
            FinanceWorkSummary(25, 4, listOf(DriverCurrency("MXN", 2) to "996.87", DriverCurrency("USD", 2) to "0.000001"))
        } } }
        compose.onNodeWithText("Pedidos entregados").assertIsDisplayed()
        compose.onNodeWithText("25").assertIsDisplayed()
        compose.onNodeWithText("Incidencias").assertIsDisplayed()
        compose.onNodeWithText("4").assertIsDisplayed()
        compose.onNodeWithText("$996.87 MXN").assertIsDisplayed()
        compose.onNodeWithText("0.000001 USD", substring = true).assertIsDisplayed()
    }
    @Test fun routeReturnSitsToTheRightOfTheRouteName() {
        var returned = false
        compose.setContent { DriverTheme { Column(Modifier.width(320.dp)) {
            FinanceRouteHeader("entrega 10", "2026-10-01", true) { returned = true }
        } } }
        val title = compose.onNodeWithText("entrega 10").assertIsDisplayed().fetchSemanticsNode().boundsInRoot
        val back = compose.onNodeWithText("Volver a mis rutas").assertIsDisplayed()
        val backBounds = back.fetchSemanticsNode().boundsInRoot
        assertTrue(title.right < backBounds.left)
        assertTrue(backBounds.top <= title.bottom && backBounds.bottom >= title.top)
        back.performClick()
        compose.runOnIdle { assertTrue(returned) }
    }
    @Test fun methodCardsShareOneRowAndKeepFullMoneyAndCurrency() {
        compose.setContent { DriverTheme { Column(Modifier.width(320.dp)) {
            FinanceMethodTiles("1086.5", "0", "0", DriverCurrency("MXN", 2))
        } } }
        val cards = listOf("Efectivo", "Transferencias", "Crédito").map { label ->
            compose.onNodeWithText(label).assertIsDisplayed().fetchSemanticsNode().boundsInRoot
        }
        cards.zipWithNext().forEach { (left, right) ->
            assertEquals(left.top, right.top, 2f)
            assertTrue(left.right <= right.left)
        }
        cards.forEach { assertTrue(it.height / it.width in .9f..1.3f) }
        compose.onNodeWithText("$1,086.50").assertIsDisplayed()
        compose.onAllNodesWithText("MXN").assertCountEquals(3)
    }
    @Test fun moneyTilesPreserveLongExactAmountsWithLargeFonts() {
        compose.setContent { DriverTheme { CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, 1.5f)) {
            Column(Modifier.width(320.dp)) {
                FinanceMethodTiles("9007199254740993.01", "0.000001", "20", DriverCurrency("MXN", 2))
            }
        } } }
        compose.onNodeWithText("$9,007,199,254,740,993.01").assertIsDisplayed()
        compose.onNodeWithText("$0.000001").assertIsDisplayed()
        compose.onNodeWithText("$20.00").assertIsDisplayed()
        compose.onAllNodesWithText("MXN").assertCountEquals(3)
    }
    @Test fun nativeBackReturnsFromFinanceDetailBeforeLeavingTheTabAndClosesDialogsFirst() {
        var selected by mutableStateOf<String?>("selected-execution")
        var drawerOpen by mutableStateOf(false)
        var dialogOpen by mutableStateOf(true)
        var homes = 0
        compose.setContent { DriverTheme {
            DriverShellBackHandler(drawerOpen, DriverDestination.FINANCE, selected,
                onCloseDrawer = { drawerOpen = false }, onFinanceRoutes = { selected = null }, onHome = { homes++ })
            Text(if (selected != null) "Detalle de ruta" else "Mis rutas de liquidación")
            if (dialogOpen) AlertDialog(onDismissRequest = { dialogOpen = false }, title = { Text("Confirmar liquidación") },
                confirmButton = { TextButton(onClick = { dialogOpen = false }) { Text("Aceptar") } })
        } }
        compose.waitForIdle()
        androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)
        compose.onNodeWithText("Confirmar liquidación").assertDoesNotExist()
        compose.onNodeWithText("Detalle de ruta").assertIsDisplayed()
        compose.runOnIdle { assertEquals(0, homes); drawerOpen = true }
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.runOnIdle { assertFalse(drawerOpen); assertNotNull(selected); assertEquals(0, homes) }
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.onNodeWithText("Mis rutas de liquidación").assertIsDisplayed()
        compose.runOnIdle { assertEquals(0, homes) }
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.runOnIdle { assertEquals(1, homes) }
    }
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
