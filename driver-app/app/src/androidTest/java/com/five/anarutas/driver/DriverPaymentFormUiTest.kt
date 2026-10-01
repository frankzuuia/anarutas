package com.five.anarutas.driver

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Actual UI controls; no provider, account, server or payment is simulated. */
@RunWith(AndroidJUnit4::class)
class DriverPaymentFormUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun methodCardsAreExclusiveLargeRadiosAndCannotChangeWhileDisabled() {
        var method by mutableStateOf("")
        var enabled by mutableStateOf(true)
        compose.setContent { DriverTheme { PaymentMethodPicker(method, enabled) { method = it } } }
        for (name in listOf("Efectivo", "Transferencia", "Crédito", "Efectivo + transferencia")) {
            val card = compose.onNodeWithText(name)
            card.assertIsNotSelected()
                .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.RadioButton))
                .assertHeightIsAtLeast(88.dp)
        }
        compose.onNodeWithText("Efectivo").performClick().assertIsSelected()
        compose.onNodeWithText("Transferencia").performClick().assertIsSelected()
        compose.onNodeWithText("Efectivo").assertIsNotSelected()
        compose.onNodeWithText("Crédito").performClick().assertIsSelected()
        compose.onNodeWithText("Transferencia").assertIsNotSelected()
        compose.onNodeWithText("Efectivo + transferencia").performClick().assertIsSelected()
        compose.onNodeWithText("Crédito").assertIsNotSelected()
        compose.runOnIdle { enabled = false }
        compose.onNodeWithText("Efectivo").assertIsNotEnabled().performClick()
        compose.onNodeWithText("Efectivo + transferencia").assertIsSelected()
        compose.runOnIdle { assertEquals("mixed", method) }
    }

    @Test fun fieldsNameTheReceivedMethodNeverOfferChangeAndDoNotFillBlankTransfers() {
        var method by mutableStateOf("cash")
        var amount by mutableStateOf("")
        compose.setContent { DriverTheme { PaymentReceivedField(method, amount, true) { amount = it } } }
        compose.onNodeWithText("Cambio entregado").assertDoesNotExist()
        compose.onNodeWithText("Efectivo recibido").assertIsDisplayed()
        compose.runOnIdle { method = "transfer" }
        compose.onNodeWithText("Efectivo recibido").assertDoesNotExist()
        compose.onNodeWithText("Monto transferido").performTextInput("15.25")
        compose.runOnIdle { assertEquals("15.25", amount) }
        compose.onNodeWithText("Monto transferido").performTextClearance()
        compose.runOnIdle { assertEquals("", amount) }
        compose.onNodeWithText("Anota cuánto transfirió el cliente. El importe es obligatorio.").assertExists()
        compose.runOnIdle { method = "credit" }
        compose.onAllNodes(hasSetTextAction()).assertCountEquals(0)
        compose.onNodeWithText("El importe queda a crédito; no se registra dinero recibido.").assertIsDisplayed()
    }

    @Test fun largeTextKeepsLabelsInsideNarrowCards() {
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 1.5f)) {
                DriverTheme { Column(Modifier.width(320.dp)) { PaymentMethodPicker("transfer", true) {} } }
            }
        }
        val card = compose.onNodeWithText("Transferencia").fetchSemanticsNode().boundsInRoot
        for (label in listOf("Transferencia", "Pago enviado a la cuenta")) {
            val text = compose.onNodeWithText(label, useUnmergedTree = true).assertIsDisplayed().fetchSemanticsNode().boundsInRoot
            assertTrue(text.left >= card.left && text.right <= card.right)
            assertTrue(text.top >= card.top && text.bottom <= card.bottom)
        }
    }

    @Test fun combinedPaymentHasTwoExplicitFieldsAndPreservesEachValue() {
        var cash by mutableStateOf("")
        var transfer by mutableStateOf("")
        compose.setContent { DriverTheme { CombinedPaymentFields(cash, transfer, true, { cash = it }, { transfer = it }) } }
        compose.onNodeWithText("Parte en efectivo").performTextInput("1000")
        compose.onNodeWithText("Parte por transferencia").performTextInput("1383.38")
        compose.runOnIdle { assertEquals("1000", cash); assertEquals("1383.38", transfer) }
        compose.onNodeWithText("Cambio entregado").assertDoesNotExist()
    }
}
