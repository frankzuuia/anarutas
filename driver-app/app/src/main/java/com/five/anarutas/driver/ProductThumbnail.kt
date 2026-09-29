package com.five.anarutas.driver

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import java.io.IOException

private val imageDownloads = Semaphore(4)

private fun decodeProductThumbnail(bytes: ByteArray?): ImageBitmap? {
    if (bytes == null) return null
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth !in 1..128 || bounds.outHeight !in 1..128) throw IOException("INVALID_PRODUCT_IMAGE")
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap() ?: throw IOException("INVALID_PRODUCT_IMAGE")
}

@Composable
internal fun ProductThumbnail(line: DeliveryLine) {
    val context = LocalContext.current.applicationContext
    val path = line.thumbnailPath
    val bitmap by produceState<ImageBitmap?>(null, path) {
        value = null
        if (path == null || !isProductThumbnailPath(path)) return@produceState
        while (true) {
            var wait = 30_000L
            try {
                withContext(Dispatchers.IO) {
                    val access = DeviceCredentials(context).load()
                    if (access.token.isBlank()) { value = null; return@withContext }
                    val cache = ProductThumbnailStore(context.cacheDir)
                    val stored = runCatching { cache.read(BuildConfig.SERVER_URL, access.deviceId, path) }.getOrNull()
                    value = runCatching { decodeProductThumbnail(stored?.bytes) }.getOrNull()
                    if (stored?.fresh == true && (stored.bytes == null || value != null)) {
                        wait = 15 * 60_000L
                        return@withContext
                    }
                    try {
                        val bytes = imageDownloads.withPermit { DriverApi(BuildConfig.SERVER_URL).productThumbnailBytes(access.token, path) }
                        value = decodeProductThumbnail(bytes)
                        runCatching { cache.save(BuildConfig.SERVER_URL, access.deviceId, path, bytes) }
                        wait = 15 * 60_000L
                    } catch (error: DriverApiException) {
                        if (error.status in listOf(401, 403, 404, 409)) {
                            value = null
                            runCatching { cache.remove(BuildConfig.SERVER_URL, access.deviceId, path) }
                        }
                    }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { /* Auxiliary images never disable order actions. */ }
            delay(wait)
        }
    }
    ProductThumbnailFrame(bitmap, line.name)
}

@Composable
internal fun ProductThumbnailFrame(bitmap: ImageBitmap?, name: String) {
    Surface(Modifier.size(40.dp), shape = RoundedCornerShape(8.dp), color = DriverColors.raised) {
        if (bitmap != null) Image(bitmap, "Foto de $name", Modifier.fillMaxSize().padding(2.dp), contentScale = ContentScale.Fit)
        else Box(contentAlignment = Alignment.Center) {
            Image(painterResource(R.drawable.five_logo), "Five · sin foto disponible", Modifier.fillMaxSize().padding(3.dp),
                contentScale = ContentScale.Fit, alpha = .28f,
                colorFilter = ColorFilter.colorMatrix(ColorMatrix(floatArrayOf(
                    0f, 0f, 0f, 0f, 255f, 0f, 0f, 0f, 0f, 255f, 0f, 0f, 0f, 0f, 255f,
                    .2126f, .7152f, .0722f, 0f, 0f,
                ))))
        }
    }
}
