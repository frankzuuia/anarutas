package com.five.anarutas.driver

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ProductThumbnailUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    @Test fun fallbackDoesNotConsumeTheOrderLineClick() {
        var clicked = false
        compose.setContent { DriverTheme {
            Row(Modifier.clickable { clicked = true }) {
                ProductThumbnail(DeliveryLine("Queso", 2.0, "kg"))
                Text("Queso")
                Text("1 kg")
            }
        } }
        compose.onNodeWithContentDescription("Five · sin foto disponible", useUnmergedTree = true).assertExists().performTouchInput { click() }
        compose.runOnIdle { assertTrue(clicked) }
        compose.onNodeWithText("1 kg").assertExists()
    }
    @Test fun actualBitmapReplacesTheFiveFallback() {
        val bitmap = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888).asImageBitmap()
        compose.setContent { DriverTheme { ProductThumbnailFrame(bitmap, "Queso") } }
        compose.onNodeWithContentDescription("Foto de Queso").assertExists()
        compose.onNodeWithContentDescription("Five · sin foto disponible").assertDoesNotExist()
    }
}
