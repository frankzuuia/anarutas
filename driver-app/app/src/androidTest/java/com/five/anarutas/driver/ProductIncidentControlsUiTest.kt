package com.five.anarutas.driver

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Executes real UI controls, file decoding and Android semantics; no network mocks. */
@RunWith(AndroidJUnit4::class)
class ProductIncidentControlsUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun shortagesCaptureQuantityAndUnitOnceWithOnlyTheRelevantQuickComment() {
        var product by mutableStateOf("")
        var quantity by mutableStateOf("")
        var unit by mutableStateOf("")
        var comments by mutableStateOf(emptyList<String>())
        compose.setContent { DriverTheme {
            ServiceFormSurface({}, compact = true, header = { Text("FALTANTE DESDE BODEGA") }, footer = {}) {
                ShortageProductFields(product, quantity, unit, true, { product = it }, { quantity = it }, { unit = it })
                ProductCommentChoices(comments, true, productCommentOptions(ProductIncidentKind.SHORTAGE_WAREHOUSE)) { comments = it }
            }
        } }
        compose.onNodeWithText("Producto faltante").performTextInput("Chile serrano")
        compose.onNodeWithText("Cantidad faltante").performTextInput("1")
        compose.onNodeWithText("Unidad", substring = false).performTextInput("kg")
        compose.onAllNodes(hasSetTextAction()).assertCountEquals(3)
        compose.onNodeWithText("No venía el producto en el pedido").performScrollTo().performClick().assertIsSelected()
        for (label in listOf("Especiales", "No cumple con las especificaciones del cliente", "Se modificó la cantidad en la orden"))
            compose.onNodeWithText(label).assertDoesNotExist()
        compose.runOnIdle {
            assertEquals("Chile serrano", product); assertEquals("1", quantity); assertEquals("kg", unit)
            assertEquals(listOf("product_not_ordered"), comments)
        }
    }

    @Test fun multipleCommentsAndClassificationAreSelectableAndFooterStaysVisible() {
        var comments by mutableStateOf(emptyList<String>())
        var department by mutableStateOf("")
        var concept by mutableStateOf("")
        compose.setContent { DriverTheme {
            ServiceFormSurface({}, compact = true, header = { Text("INCIDENCIA DE PRODUCTO", Modifier.testTag("header")) },
                footer = { AppAction("Guardar incidencia", DriverIcon.CHECK, Modifier.fillMaxWidth()) {} }) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ProductSelectField("Departamento", department, productDepartments.map { it to it }, true, Modifier.weight(1f)) { department = it }
                    ProductSelectField("Concepto", concept, productConcepts.map { it to it }, true, Modifier.weight(1f)) { concept = it }
                }
                ProductCommentChoices(comments, true) { comments = it }
                ServiceNoteField("Notas adicionales de QA", {}, "Notas adicionales", true)
                repeat(8) { Text("Información adicional para comprobar el scroll") }
            }
        } }
        compose.onNodeWithContentDescription("Departamento").performClick()
        compose.onNodeWithText("Ventas").performClick()
        compose.onNodeWithContentDescription("Concepto").performClick()
        compose.onNodeWithText("Picking").performClick()
        for (text in listOf("Especiales", "No venía el producto en el pedido")) compose.onNodeWithText(text).performScrollTo().performClick().assertIsSelected()
        compose.runOnIdle { assertEquals("Ventas", department); assertEquals("Picking", concept); assertEquals(2, comments.size) }
        compose.onNodeWithText("Especiales").performScrollTo().performClick().assertIsNotSelected()
        compose.onNodeWithText("Guardar incidencia").assertIsDisplayed()
        compose.onNodeWithTag("header").assertIsDisplayed()
        capture("product-controls.png")
    }

    @Test fun threeThumbnailsRemoveOnlyTheChosenPhotoAndBlockRemovalWhileSending() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val folder = File(context.cacheDir, "product-ui-qa").apply { mkdirs() }
        val images = (1..3).map { index ->
            File(folder, "photo-$index.jpg").also { file ->
                val bitmap = Bitmap.createBitmap(48, 48, Bitmap.Config.ARGB_8888)
                bitmap.eraseColor(android.graphics.Color.rgb(index * 50, 120, 80))
                file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }
                bitmap.recycle()
            }.absolutePath
        }
        var paths by mutableStateOf(images)
        var editable by mutableStateOf(true)
        val loaded = mutableSetOf<String>()
        compose.setContent { DriverTheme {
            ServiceFormSurface({}, compact = true, header = { Text("EVIDENCIA · 3 FOTOS") },
                footer = { AppAction("Guardar incidencia", DriverIcon.CHECK, Modifier.fillMaxWidth()) {} }) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    paths.forEachIndexed { index, path -> key(path) {
                        CapturedProductPhoto(path, index + 1, editable, { if (it) loaded.add(path) }) { paths = paths - path }
                    } }
                }
            }
        } }
        compose.waitUntil(10_000) { loaded.size == 3 }
        compose.onNodeWithContentDescription("Quitar foto 2").assertIsDisplayed().performClick()
        compose.runOnIdle { assertEquals(listOf(images[0], images[2]), paths) }
        compose.onAllNodes(hasContentDescription("Evidencia", substring = true)).assertCountEquals(2)
        compose.runOnIdle { editable = false }
        compose.onNodeWithContentDescription("Quitar foto 1").assertIsNotEnabled()
        compose.runOnIdle { editable = true }
        compose.onNodeWithContentDescription("Quitar foto 1").performClick()
        compose.runOnIdle { assertEquals(listOf(images[2]), paths) }
        capture("product-photo.png")
        images.forEach { File(it).delete() }
    }

    private fun capture(name: String) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val bitmap = instrumentation.uiAutomation.takeScreenshot()
        val target = File(instrumentation.targetContext.getExternalFilesDir(null), name)
        target.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
}
