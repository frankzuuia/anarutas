package com.five.anarutas.driver

import android.graphics.BitmapFactory
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.core.content.FileProvider
import java.io.File
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private val dialogSurface = Color(0xFF171E19)
private val dialogMuted = Color(0xFFAEB9AF)

@Composable
internal fun UnitPhotosDialog(state: DriverUiState, model: DriverViewModel) {
    val context = LocalContext.current
    val route = state.selected ?: state.dashboard?.today ?: return
    var pendingCameraPath by rememberSaveable { mutableStateOf<String?>(null) }
    var photoToDelete by rememberSaveable { mutableStateOf<String?>(null) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { saved ->
        val file = pendingCameraPath?.let(::File)
        pendingCameraPath = null
        if (saved && file != null && file.isFile && file.length() > 0L)
            model.uploadUnitPhoto(context, file)
        else file?.delete()
    }
    Dialog(onDismissRequest = { if (!state.busy) model.closePhotos() }) {
        Surface(color = dialogSurface, shape = RoundedCornerShape(20.dp), modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(17.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Column {
                        Text("Fotos de la unidad", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                        Text("${route.vehicle} · ${route.photoCount} de 8", color = dialogMuted, fontSize = 12.sp)
                    }
                    TextButton(onClick = model::closePhotos) { Text("Cerrar") }
                }
                if (state.photos.isEmpty()) {
                    Text("Fotografía exterior, placas, llantas y estado general antes de salir.", color = dialogMuted, fontSize = 12.sp)
                } else {
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(3),
                        modifier = Modifier.fillMaxWidth().height(230.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        itemsIndexed(state.photos, key = { _, photo -> photo.id }) { index, photo ->
                            Column {
                                PhotoThumbnail(photo, state.token, 78.dp)
                                if (route.startedAt == null) {
                                    TextButton(
                                        modifier = Modifier.semantics { contentDescription = "Eliminar foto ${index + 1}" },
                                        enabled = !state.busy,
                                        onClick = { photoToDelete = photo.id },
                                    ) { Text("Eliminar", color = Color(0xFFF2A6A1), fontSize = 11.sp) }
                                }
                            }
                        }
                    }
                }
                if (route.startedAt == null) {
                    OutlinedButton(enabled = !state.busy && route.photoCount < 8 && pendingCameraPath == null, onClick = {
                        val directory = File(context.cacheDir, "unit-camera").also { it.mkdirs() }
                        val file = File(directory, "unit-${UUID.randomUUID()}.jpg")
                        pendingCameraPath = file.absolutePath
                        try {
                            camera.launch(FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file))
                        } catch (_: RuntimeException) {
                            pendingCameraPath = null
                            file.delete()
                            model.cameraUnavailable()
                        }
                    }) { Text("Tomar foto", fontSize = 12.sp) }
                    Text("Mínimo 5 fotos distintas tomadas hoy para iniciar.", color = dialogMuted, fontSize = 11.sp)
                } else {
                    Text("Ruta iniciada · las fotos de salida quedan cerradas.", color = dialogMuted, fontSize = 12.sp)
                }
                if (state.error.isNotBlank()) Text(state.error, color = Color(0xFFF2A6A1), fontSize = 12.sp)
                if (state.notice.isNotBlank()) Text(state.notice, color = Color(0xFF93CD4B), fontSize = 12.sp)
            }
        }
    }
    photoToDelete?.let { photoId ->
        val photo = state.photos.firstOrNull { it.id == photoId }
        if (photo != null && route.startedAt == null) {
            AlertDialog(
                onDismissRequest = { if (!state.busy) photoToDelete = null },
                title = { Text("¿Eliminar esta foto?") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        PhotoThumbnail(photo, state.token, 180.dp)
                        Text("Podrás tomar otra antes de iniciar. Las fotos de una ruta iniciada no se pueden borrar.")
                    }
                },
                confirmButton = {
                    TextButton(enabled = !state.busy, onClick = {
                        photoToDelete = null
                        model.deleteUnitPhoto(photoId)
                    }) { Text("Eliminar foto", color = Color(0xFFF2A6A1)) }
                },
                dismissButton = {
                    TextButton(enabled = !state.busy, onClick = { photoToDelete = null }) { Text("Conservar foto") }
                },
                containerColor = dialogSurface,
                titleContentColor = Color.White,
                textContentColor = dialogMuted,
            )
        }
    }
}

@Composable
private fun PhotoThumbnail(photo: UnitPhoto, token: String, size: Dp) {
    val bitmap by produceState<ImageBitmap?>(null, photo.id, token) {
        value = runCatching {
            val bytes = DriverApi(BuildConfig.SERVER_URL).photoBytes(token, photo.id)
            withContext(Dispatchers.Default) {
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
            }
        }.getOrNull()
    }
    if (bitmap != null) {
        Image(
            bitmap = bitmap!!,
            contentDescription = "Foto de la camioneta",
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(size).background(Color(0xFF263229), RoundedCornerShape(8.dp)),
        )
    } else {
        Surface(color = Color(0xFF263229), shape = RoundedCornerShape(8.dp), modifier = Modifier.size(size)) {
            Text("Foto", color = dialogMuted, fontSize = 11.sp, modifier = Modifier.padding(15.dp))
        }
    }
}

@Composable
internal fun OrderDetailDialog(order: DeliveryOrder, onClose: () -> Unit) {
    Dialog(onDismissRequest = onClose) {
        Surface(color = dialogSurface, shape = RoundedCornerShape(20.dp), modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.heightIn(max = 600.dp).verticalScroll(rememberScrollState()).padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Parada ${order.position} · ${order.name}", color = Color(0xFF93CD4B), fontSize = 12.sp, fontWeight = FontWeight.Bold)
                Text(order.customer, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Text(order.address, color = dialogMuted, fontSize = 13.sp)
                if (order.note.isNotBlank()) Text(order.note, color = dialogMuted, fontSize = 12.sp)
                order.lines.forEach { line ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(line.name, color = Color.White, fontSize = 12.sp, modifier = Modifier.weight(1f))
                        Text("${line.quantity} ${line.unit}", color = Color(0xFF93CD4B), fontSize = 12.sp)
                    }
                }
                TextButton(onClick = onClose) { Text("Cerrar detalle") }
            }
        }
    }
}
