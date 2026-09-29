package com.five.anarutas.driver

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Real presentation components and Android IME. No server or domain data is mocked. */
@RunWith(AndroidJUnit4::class)
class IncidentFormUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun cardsExposeExclusiveRadioSelectionAndRespectDisabledState() {
        var selected by mutableStateOf(IncidentChoice.CUSTOMER_CLOSED)
        var available by mutableStateOf(true)
        var hasOrders by mutableStateOf(true)
        compose.setContent { DriverTheme {
            Column(Modifier.selectableGroup()) {
                IncidentChoice.entries.forEach { choice ->
                    IncidentChoiceCard(choice, selected == choice, incidentChoiceEnabled(choice, available, hasOrders)) { selected = choice }
                }
            }
        } }
        val closed = compose.onNodeWithText("Cliente cerrado")
        val rejected = compose.onNodeWithText("Pedido rechazado")
        for (text in listOf("Faltante por validación", "Faltante desde bodega")) {
            compose.onNodeWithText(text).performClick().assertIsSelected()
            closed.assertIsNotSelected()
        }
        closed.performClick()
        closed.assertIsSelected().assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.RadioButton))
        rejected.assertIsNotSelected().performClick()
        rejected.assertIsSelected()
        closed.assertIsNotSelected().performClick()
        closed.assertIsSelected()
        compose.runOnIdle { hasOrders = false }
        rejected.assertIsNotEnabled().performClick()
        closed.assertIsSelected()
        compose.runOnIdle { available = false }
        closed.assertIsNotEnabled()
        rejected.assertIsNotEnabled()
    }

    @Test fun keyboardTypingAndFeedbackDoNotRecenterHeaderOrClearDraft() {
        var feedback by mutableStateOf("Ruta sincronizada")
        var imeBottom by mutableIntStateOf(0)
        var dismissed = 0
        compose.setContent { DriverTheme {
            ServiceFormSurface({ dismissed++ }, header = { Text("REPORTAR INCIDENCIA", Modifier.testTag("form-header")) }) {
                val density = LocalDensity.current
                val bottom = WindowInsets.ime.getBottom(density)
                SideEffect { imeBottom = bottom }
                var note by rememberSaveable { mutableStateOf("") }
                Column(Modifier.selectableGroup(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    IncidentChoice.entries.forEach { choice -> IncidentChoiceCard(choice, choice == IncidentChoice.CUSTOMER_CLOSED, true) {} }
                }
                ServiceNoteField(note, { note = it }, "Comentario · opcional", true, Modifier.testTag("form-note"))
                repeat(8) { Text(feedback) }
            }
        } }
        val editor = compose.onNodeWithTag("form-note")
        editor.performScrollTo().performClick()
        compose.waitUntil(10_000) { imeBottom > 0 }
        compose.waitForIdle()
        val headerTop = compose.onNodeWithTag("form-header").fetchSemanticsNode().boundsInRoot.top
        for (index in 1..5) {
            editor.performTextInput("Línea $index\n")
            compose.runOnIdle { feedback = "Refresco $index" }
            compose.waitForIdle()
            assertEquals(headerTop, compose.onNodeWithTag("form-header").fetchSemanticsNode().boundsInRoot.top, 1f)
            editor.assertIsFocused().assertIsDisplayed()
        }
        editor.assert(hasText((1..5).joinToString("") { "Línea $it\n" }))
        editor.performImeAction()
        compose.waitUntil(10_000) { imeBottom == 0 }
        editor.assertIsNotFocused().assert(hasText((1..5).joinToString("") { "Línea $it\n" }))
        compose.runOnIdle { assertEquals(0, dismissed) }
    }
}
