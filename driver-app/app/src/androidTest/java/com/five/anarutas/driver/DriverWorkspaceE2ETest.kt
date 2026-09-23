package com.five.anarutas.driver

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Runs against the installed app's actual authenticated account and published server data.
 * It neither seeds data nor starts routes, deletes photos, or simulates HTTP responses.
 */
@RunWith(AndroidJUnit4::class)
class DriverWorkspaceE2ETest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    private fun waitForHome() {
        compose.waitUntil(30_000) { compose.onAllNodesWithText("Tu espacio").fetchSemanticsNodes().isNotEmpty() }
    }

    // A closed drawer can remain in the semantics tree. Target the visible control,
    // not an off-screen copy of a card title or the Five wordmark.
    private fun visible(matcher: SemanticsMatcher): SemanticsNodeInteraction {
        val nodes = compose.onAllNodes(matcher)
        return (nodes.fetchSemanticsNodes().indices).map { nodes[it] }.first { it.isDisplayed() }
    }

    private fun snapshot(name: String) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "qa-workspace").apply { mkdirs() }
        val bitmap = instrumentation.uiAutomation.takeScreenshot() ?: error("Android no entregó una captura")
        try { File(directory, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) } }
        finally { bitmap.recycle() }
    }

    @Test fun homeCardsDrawerAndRealRouteStayConnected() {
        waitForHome()
        visible(hasContentDescription("Five Fine Vegetables")).assertIsDisplayed()
        visible(hasText("Ruta activa")).assertIsDisplayed()
        visible(hasText("Mi unidad")).assertIsDisplayed()
        snapshot("01-inicio")
        visible(hasText("Ruta activa")).performClick()
        compose.onNodeWithText("Tu ruta").assertIsDisplayed()
        snapshot("02-ruta")
        compose.onNodeWithContentDescription("Abrir menú").performClick()
        visible(hasText("Preferencias")).assertIsDisplayed()
        snapshot("03-menu")
        visible(hasText("Preferencias")).performClick()
        compose.onNodeWithText("Mantener pantalla activa").assertIsDisplayed()
        compose.onNodeWithText("Permisos de la app").assertIsDisplayed()
        snapshot("04-preferencias")
        compose.activityRule.scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
        waitForHome()
        visible(hasText("Mi unidad")).performClick()
        compose.onNodeWithText("Revisión de salida").assertIsDisplayed()
        snapshot("05-unidad")
    }

    @Test fun ordersSearchFiltersRealDataWithoutChangingAssignment() {
        waitForHome()
        visible(hasText("Pedidos") and hasClickAction()).performClick()
        compose.waitForIdle()
        val search = compose.onAllNodes(hasSetTextAction())
        if (search.fetchSemanticsNodes().isNotEmpty()) {
            search.onFirst().performTextInput("qa-no-coincidencia-8271")
            compose.onNodeWithText("Sin coincidencias").assertIsDisplayed()
            compose.onNodeWithContentDescription("Limpiar búsqueda").performClick()
            compose.onNodeWithText("Sin coincidencias").assertDoesNotExist()
        } else compose.onNodeWithText("Sin pedidos asignados").assertIsDisplayed()
        snapshot("06-pedidos")
    }
}
