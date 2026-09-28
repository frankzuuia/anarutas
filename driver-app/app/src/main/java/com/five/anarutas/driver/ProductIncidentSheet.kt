package com.five.anarutas.driver

import android.graphics.BitmapFactory
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

@Composable
internal fun ProductIncidentSheet(stop: ExecutionStop, order: DeliveryOrder, lineIndex: Int?,
    initialKind: ProductIncidentKind, model: RouteExecutionModel, close: () -> Unit) {
    val state = model.state
    val context = LocalContext.current
    val line = lineIndex?.let { order.lines.getOrNull(it) }
    var kindCode by rememberSaveable(stop.id, order.id, lineIndex) { mutableStateOf(initialKind.wire) }
    val kind = ProductIncidentKind.entries.first { it.wire == kindCode }
    var product by rememberSaveable(stop.id, order.id, lineIndex) { mutableStateOf(line?.name.orEmpty()) }
    var unit by rememberSaveable(stop.id, order.id, lineIndex) { mutableStateOf(line?.unit.orEmpty()) }
    var quantity by rememberSaveable(stop.id, order.id, lineIndex) { mutableStateOf("") }
    var note by rememberSaveable(stop.id, order.id, lineIndex) { mutableStateOf("") }
    var warehouseReason by rememberSaveable(stop.id, order.id, lineIndex) { mutableStateOf("") }
    var department by rememberSaveable(stop.id, order.id, lineIndex) { mutableStateOf("") }
    val remaining = if (line != null) remainingProductQuantity(line.quantity, stop.productIncidents, order.id, lineIndex) else null
    val status = stop.orderStates.find { it.shipmentId == order.id }?.status
    val available = state.verified && !state.busy && !state.pending && !state.retired && stop.canAttend() &&
        status in listOf(OrderServiceStatus.OPEN, OrderServiceStatus.REJECTED, OrderServiceStatus.CLOSED_PENDING)
    var revision by remember { mutableIntStateOf(state.productRevision) }
    var cameraPath by rememberSaveable(stop.id, order.id, lineIndex) { mutableStateOf<String?>(null) }
    var photoPath by rememberSaveable(stop.id, order.id, lineIndex) { mutableStateOf<String?>(null) }
    var photoError by remember { mutableStateOf("") }
    fun discardPhoto(path: String?) {
        path?.let(::File)?.let { file ->
            if (file.canonicalFile.parentFile == File(context.cacheDir, "incident-camera").canonicalFile) file.delete()
        }
    }
    fun dismiss() { if (!state.busy) { discardPhoto(photoPath); close() } }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { saved ->
        val file = cameraPath?.let(::File); cameraPath = null
        if (saved && file?.isFile == true && file.length() in 1..8L * 1024 * 1024) {
            discardPhoto(photoPath); photoPath = file.absolutePath; photoError = ""
        } else {
            discardPhoto(file?.absolutePath)
            if (saved) photoError = "La fotografía está vacía o supera 8 MB. Tómala con menor resolución."
        }
    }
    val preview by produceState<ImageBitmap?>(null, photoPath) {
        value = withContext(Dispatchers.IO) { photoPath?.let { path ->
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(path, bounds)
            var sample = 1
            while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 640) sample *= 2
            BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
        } }
    }
    LaunchedEffect(state.productRevision) {
        if (revision != state.productRevision) { revision = state.productRevision; discardPhoto(photoPath); close() }
    }
    ServiceFormSurface(::dismiss, header = {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("INCIDENCIA DE PRODUCTO", style = MaterialTheme.typography.labelSmall, color = DriverColors.lime)
                Text(order.name, style = MaterialTheme.typography.titleLarge)
                Text(stop.customer, style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
            }
            AppIconButton(DriverIcon.CLOSE, "Cerrar incidencia de producto", enabled = !state.busy, onClick = ::dismiss)
        }
    }) {
        ProductIncidentKind.entries.filter { it.manual == (lineIndex == null) }.forEach { option ->
            FilterChip(selected = kind == option, onClick = { kindCode = option.wire }, enabled = available,
                label = { Text(option.label) }, modifier = Modifier.fillMaxWidth())
        }
        Text("Departamento", style = MaterialTheme.typography.titleMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("Operaciones", "Compras").forEach { name -> FilterChip(department == name,
                { department = name }, enabled = available, label = { Text(name) }) }
        }
        if (line == null) {
            if (kind == ProductIncidentKind.SHORTAGE_WAREHOUSE) {
                Text("Motivo desde bodega", style = MaterialTheme.typography.titleMedium)
                WarehouseReason.entries.forEach { reason -> FilterChip(warehouseReason == reason.wire,
                    { warehouseReason = reason.wire }, enabled = available, label = { Text(reason.label) }, modifier = Modifier.fillMaxWidth()) }
            }
            OutlinedTextField(product, { product = it.take(300) }, modifier = Modifier.fillMaxWidth(),
                label = { Text("Producto que hizo falta") }, enabled = available, singleLine = true)
            OutlinedTextField(unit, { unit = it.take(40) }, modifier = Modifier.fillMaxWidth(),
                label = { Text("Unidad · kg, piezas, cajas…") }, enabled = available, singleLine = true)
        } else {
            Text(line.name, style = MaterialTheme.typography.titleMedium)
            Text("En pedido: ${line.quantity} ${line.unit} · Disponible para reportar: ${remaining?.stripTrailingZeros()?.toPlainString()} ${line.unit}",
                style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
        }
        OutlinedTextField(quantity, { quantity = it.take(20) }, modifier = Modifier.fillMaxWidth(),
            label = { Text(if (kind == ProductIncidentKind.RETURN) "Cantidad devuelta · $unit" else "Cantidad afectada · $unit") },
            enabled = available, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
        if (remaining != null) TextButton(enabled = available && remaining.signum() > 0,
            onClick = { quantity = remaining.stripTrailingZeros().toPlainString() }) { Text("Toda la cantidad disponible") }
        if (quantity.isNotBlank() && !productIncidentValid(kind, quantity, product, unit, remaining, note))
            Text("Escribe una cantidad positiva válida, sin exceder lo disponible, y completa producto y unidad.",
                style = MaterialTheme.typography.bodySmall, color = DriverColors.amber)
        ServiceNoteField(note, { note = it }, "Notas · qué ocurrió y qué se necesita", available)
        Text(if (productEvidenceRequired(kind)) "Evidencia fotográfica · obligatoria" else "Evidencia fotográfica · opcional",
            style = MaterialTheme.typography.titleMedium)
        preview?.let { Image(it, "Evidencia del producto", Modifier.fillMaxWidth().height(160.dp), contentScale = ContentScale.Crop) }
        AppAction(if (photoPath == null) "Tomar fotografía" else "Tomar otra foto", DriverIcon.CAMERA,
            Modifier.fillMaxWidth(), quiet = true, enabled = available && cameraPath == null) {
            val directory = File(context.cacheDir, "incident-camera").also { it.mkdirs() }
            val file = File(directory, "incident-product-${UUID.randomUUID()}.jpg")
            cameraPath = file.absolutePath
            try { camera.launch(FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)) }
            catch (_: RuntimeException) { cameraPath = null; discardPhoto(file.absolutePath); photoError = "No se pudo abrir la cámara. Revisa que esté disponible." }
        }
        if (photoPath != null) TextButton(enabled = available, onClick = { discardPhoto(photoPath); photoPath = null }) { Text("Quitar fotografía") }
        if (photoError.isNotBlank()) Text(photoError, color = DriverColors.amber)
        Text(if (kind == ProductIncidentKind.RETURN) "Se registra para administración. No genera todavía una devolución ni ajuste en Odoo."
            else "Se registra por separado. Confirma la atención del pedido cuando termines de revisar sus productos.",
            style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
        AppAction("Guardar incidencia", DriverIcon.CHECK, Modifier.fillMaxWidth(),
            enabled = available && department.isNotEmpty() && productIncidentValid(kind, quantity, product, unit, remaining, note) &&
                (!productEvidenceRequired(kind) || preview != null) && (photoPath == null || preview != null) &&
                (kind != ProductIncidentKind.SHORTAGE_WAREHOUSE || warehouseReason.isNotEmpty())) {
            model.reportProduct(stop.id, order.id, lineIndex, kind, productQuantity(quantity)!!.stripTrailingZeros().toPlainString(), product, unit, note,
                warehouseReason.takeIf { kind == ProductIncidentKind.SHORTAGE_WAREHOUSE }, department, photoPath?.let(::File))
        }
        Text(state.message, style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
        if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (state.pending) AppAction("Verificar envío", DriverIcon.REFRESH, Modifier.fillMaxWidth(), enabled = !state.busy, onClick = model::retry)
        TextButton(enabled = !state.busy, onClick = ::dismiss) { Text("Volver al pedido") }
    }
}
