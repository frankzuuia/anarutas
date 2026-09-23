package com.five.anarutas.driver

import android.graphics.BitmapFactory
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import java.io.File
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable
internal fun UnitPhotosDialog(state: DriverUiState, model: DriverViewModel) {
    val context = LocalContext.current
    val route = state.activePlan() ?: return
    val canPrepare = canPrepareRoute(route, state.dashboard?.serviceDate)
    var pendingCameraPath by rememberSaveable { mutableStateOf<String?>(null) }
    var photoToDelete by rememberSaveable { mutableStateOf<String?>(null) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { saved ->
        val file = pendingCameraPath?.let(::File)
        pendingCameraPath = null
        if (saved && file != null && file.isFile && file.length() > 0L) model.uploadUnitPhoto(context, file)
        else file?.delete()
    }
    DetailSurface(onDismiss = { if (!state.busy) model.closePhotos() }) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Fotos de la unidad", style = MaterialTheme.typography.titleLarge)
                Text("${route.vehicle} · ${route.photoCount} de 8", color = DriverColors.muted, style = MaterialTheme.typography.bodySmall)
            }
            AppIconButton(DriverIcon.CLOSE, "Cerrar fotos", enabled = !state.busy, onClick = model::closePhotos)
        }
        if (state.photos.isEmpty()) {
            AppIcon(DriverIcon.CAMERA, Modifier.size(34.dp), tint = DriverColors.purple)
            Text("Fotografía exterior, placas, llantas y estado general antes de salir.", color = DriverColors.muted, style = MaterialTheme.typography.bodyMedium)
        } else {
            LazyVerticalGrid(
                columns = GridCells.Fixed(3),
                modifier = Modifier.fillMaxWidth().height(minOf(300.dp, with(LocalDensity.current) { (LocalWindowInfo.current.containerSize.height * .35f).toDp() })),
                horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                itemsIndexed(state.photos, key = { _, photo -> photo.id }) { index, photo ->
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        PhotoThumbnail(photo, state.token, Modifier.fillMaxWidth().aspectRatio(1f))
                        if (canPrepare) AppIconButton(DriverIcon.TRASH, "Eliminar foto ${index + 1}", enabled = !state.busy) { photoToDelete = photo.id }
                    }
                }
            }
        }
        if (canPrepare) {
            AppAction("Tomar foto", DriverIcon.CAMERA, enabled = !state.busy && route.photoCount < 8 && pendingCameraPath == null) {
                val directory = File(context.cacheDir, "unit-camera").also { it.mkdirs() }
                val file = File(directory, "unit-${UUID.randomUUID()}.jpg")
                pendingCameraPath = file.absolutePath
                try { camera.launch(FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)) }
                catch (_: RuntimeException) { pendingCameraPath = null; file.delete(); model.cameraUnavailable() }
            }
            Text("Mínimo 5 fotos distintas tomadas hoy para iniciar.", color = DriverColors.muted, style = MaterialTheme.typography.bodySmall)
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AppIcon(DriverIcon.LOCK, Modifier.size(16.dp), tint = DriverColors.muted)
                Text(if (route.startedAt != null) "Ruta iniciada · revisión cerrada." else "Fotos de otra fecha · sólo consulta.", color = DriverColors.muted, style = MaterialTheme.typography.bodySmall)
            }
        }
        if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth().height(2.dp))
        StatusMessages(state)
    }
    photoToDelete?.let { photoId ->
        val photo = state.photos.firstOrNull { it.id == photoId }
        if (photo != null && canPrepare) AlertDialog(
            onDismissRequest = { if (!state.busy) photoToDelete = null }, title = { Text("¿Eliminar esta foto?") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    PhotoThumbnail(photo, state.token, Modifier.fillMaxWidth().height(180.dp))
                    Text("Podrás tomar otra antes de iniciar. Necesitas al menos 5 fotos para salir.")
                }
            },
            confirmButton = { TextButton(enabled = !state.busy, onClick = { photoToDelete = null; model.deleteUnitPhoto(photoId) }) { Text("Eliminar foto", color = DriverColors.red) } },
            dismissButton = { TextButton(enabled = !state.busy, onClick = { photoToDelete = null }) { Text("Conservar") } },
        )
    }
}

@Composable
private fun PhotoThumbnail(photo: UnitPhoto, token: String, modifier: Modifier) {
    var attempt by remember(photo.id) { mutableIntStateOf(0) }
    var failed by remember(photo.id) { mutableStateOf(false) }
    val bitmap by produceState<ImageBitmap?>(null, photo.id, token, attempt) {
        failed = false
        try {
            val bytes = DriverApi(BuildConfig.SERVER_URL).photoBytes(token, photo.id)
            value = withContext(Dispatchers.Default) {
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                var sample = 1
                while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 768) sample *= 2
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
            }
            failed = value == null
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { failed = true }
    }
    Surface(modifier = modifier.clip(RoundedCornerShape(12.dp)), color = DriverColors.raised) {
        if (bitmap != null) Image(bitmap!!, "Foto de la unidad", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        else Box(contentAlignment = Alignment.Center) {
            if (failed) AppIconButton(DriverIcon.REFRESH, "Reintentar cargar foto") { attempt++ }
            else CircularProgressIndicator(Modifier.size(19.dp), strokeWidth = 2.dp)
        }
    }
}

@Composable
internal fun DetailSurface(onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    val maxHeight = with(LocalDensity.current) { (LocalWindowInfo.current.containerSize.height * .85f).toDp() }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(color = DriverColors.surface, shape = RoundedCornerShape(26.dp), modifier = Modifier.padding(horizontal = 18.dp).widthIn(max = 520.dp).fillMaxWidth()) {
            Column(Modifier.heightIn(max = maxHeight).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp), content = content)
        }
    }
}

@Composable
internal fun OrderDetailDialog(order: DeliveryOrder, timezone: String = "America/Mexico_City", onClose: () -> Unit) {
    DetailSurface(onClose) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("PARADA ${order.position}", color = DriverColors.lime, style = MaterialTheme.typography.labelSmall)
                Text(order.name, style = MaterialTheme.typography.titleMedium, color = DriverColors.muted)
            }
            AppIconButton(DriverIcon.CLOSE, "Cerrar pedido", onClick = onClose)
        }
        Text(order.customer, style = MaterialTheme.typography.titleLarge)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            AppIcon(DriverIcon.PIN, Modifier.size(18.dp), tint = DriverColors.muted)
            Text(order.address.ifBlank { "Sin domicilio registrado" }, color = DriverColors.muted, style = MaterialTheme.typography.bodyMedium)
        }
        order.eta?.let { Text("Llegada estimada · ${formatRouteTime(it, timezone)}", style = MaterialTheme.typography.bodyMedium, color = DriverColors.lime) }
        order.phone?.takeIf { it.isNotBlank() }?.let { Text("Contacto · ${formatDriverPhone(it)}", style = MaterialTheme.typography.bodyMedium) }
        if (order.note.isNotBlank()) Surface(color = DriverColors.raised, shape = RoundedCornerShape(12.dp)) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Nota de entrega", style = MaterialTheme.typography.titleMedium)
                Text(order.note, style = MaterialTheme.typography.bodyMedium, color = DriverColors.muted)
            }
        }
        HorizontalDivider(color = DriverColors.line)
        SectionLabel("Productos", "${order.lines.size} partidas")
        order.lines.forEach { line ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.Top) {
                Text(line.name, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                Text("${line.quantity} ${line.unit}", style = MaterialTheme.typography.labelLarge, color = DriverColors.lime, modifier = Modifier.widthIn(max = 120.dp))
            }
        }
    }
}
