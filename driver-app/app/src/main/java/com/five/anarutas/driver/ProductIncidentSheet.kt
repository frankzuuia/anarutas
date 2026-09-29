package com.five.anarutas.driver

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import java.io.File
import java.util.UUID

@Composable
internal fun ProductIncidentSheet(stop: ExecutionStop, order: DeliveryOrder, lineIndex: Int?,
    initialKind: ProductIncidentKind, model: RouteExecutionModel, editingIncident: ProductIncidentRecord? = null, close: () -> Unit) {
    val state = model.state
    val context = LocalContext.current
    val line = lineIndex?.let { order.lines.getOrNull(it) }
    var savedId by rememberSaveable(stop.id, order.id, lineIndex, editingIncident?.id) { mutableStateOf(editingIncident?.id) }
    val saved = savedId?.let { id -> state.execution?.stops?.flatMap { it.productIncidents }?.find { it.id == id } } ?: editingIncident
    var kindCode by rememberSaveable(stop.id, order.id, lineIndex, editingIncident?.id) { mutableStateOf(editingIncident?.kind ?: initialKind.wire) }
    val kind = ProductIncidentKind.entries.first { it.wire == kindCode }
    var product by rememberSaveable(stop.id, order.id, lineIndex, editingIncident?.id) { mutableStateOf(editingIncident?.product ?: line?.name.orEmpty()) }
    var unit by rememberSaveable(stop.id, order.id, lineIndex, editingIncident?.id) { mutableStateOf(editingIncident?.unit ?: line?.unit.orEmpty()) }
    var quantity by rememberSaveable(stop.id, order.id, lineIndex, editingIncident?.id) { mutableStateOf(editingIncident?.quantity ?: "") }
    var note by rememberSaveable(stop.id, order.id, lineIndex, editingIncident?.id) { mutableStateOf(editingIncident?.additionalNote ?: "") }
    var warehouseReason by rememberSaveable(stop.id, order.id, lineIndex, editingIncident?.id) { mutableStateOf(editingIncident?.warehouseReason ?: "") }
    var department by rememberSaveable(stop.id, order.id, lineIndex, editingIncident?.id) { mutableStateOf(editingIncident?.department ?: "") }
    var concept by rememberSaveable(stop.id, order.id, lineIndex, editingIncident?.id) { mutableStateOf(editingIncident?.concept ?: "") }
    var comments by rememberSaveable(stop.id, order.id, lineIndex, editingIncident?.id) { mutableStateOf(editingIncident?.comments ?: emptyList()) }
    val remaining = if (line != null) remainingProductQuantity(line.quantity, stop.productIncidents, order.id, lineIndex, savedId) else null
    val status = stop.orderStates.find { it.shipmentId == order.id }?.status
    val available = state.verified && !state.busy && !state.pending && !state.retired && stop.canAttend() &&
        (saved == null || saved.status == "pending") &&
        status in listOf(OrderServiceStatus.OPEN, OrderServiceStatus.REJECTED, OrderServiceStatus.CLOSED_PENDING)
    var revision by remember { mutableIntStateOf(state.productRevision) }
    var cameraPath by rememberSaveable(stop.id, order.id, lineIndex, editingIncident?.id) { mutableStateOf<String?>(null) }
    var photos by rememberSaveable(stop.id, order.id, lineIndex, editingIncident?.id) { mutableStateOf<List<String>>(emptyList()) }
    var readyPhotos by remember { mutableStateOf(setOf<String>()) }
    var photoError by remember { mutableStateOf("") }
    val editable = !state.busy && !state.pending && cameraPath == null && (saved == null || saved.status == "pending")
    val changed = productIncidentDraftChanged(saved, kindCode, product, unit, quantity, note,
        warehouseReason, department, concept, comments)
    var confirmCancel by rememberSaveable(savedId) { mutableStateOf(false) }
    fun discardPhoto(path: String?) {
        path?.let(::File)?.let { file ->
            if (file.canonicalFile.parentFile == File(context.cacheDir, "incident-camera").canonicalFile) file.delete()
        }
    }
    fun dismiss() { if (!state.busy && cameraPath == null) { photos.forEach(::discardPhoto); close() } }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { saved ->
        val file = cameraPath?.let(::File); cameraPath = null
        if (saved && file?.isFile == true && file.length() in 1..8L * 1024 * 1024 && photos.size < 3) {
            photos = photos + file.absolutePath; photoError = ""
        } else {
            discardPhoto(file?.absolutePath)
            if (saved) photoError = "La fotografía está vacía o supera 8 MB. Tómala con menor resolución."
        }
    }
    LaunchedEffect(state.productRevision) {
        if (revision != state.productRevision) {
            revision = state.productRevision
            if (state.lastProductIncidentId == savedId && state.lastProductAction == "product-incident-cancel") close()
            else if (state.lastProductAction == "product-incident" || state.lastProductAction == "product-incident-amend") {
                savedId = state.lastProductIncidentId
                state.execution?.stops?.flatMap { it.productIncidents }?.find { it.id == savedId }?.let { confirmed ->
                    kindCode = confirmed.kind
                    product = confirmed.product
                    unit = confirmed.unit
                    quantity = confirmed.quantity
                    note = confirmed.additionalNote
                    warehouseReason = confirmed.warehouseReason
                    department = confirmed.department
                    concept = confirmed.concept
                    comments = confirmed.comments
                }
                photos.forEach(::discardPhoto); photos = emptyList(); readyPhotos = emptySet()
            }
        }
    }
    val completeNote = productCommentsText(comments, note)
    val missing = when {
        state.busy -> "Guardando incidencia…"
        state.pending -> "Envío pendiente de confirmación. No vuelvas a capturar."
        !available -> state.message
        !productIncidentValid(kind, quantity, product, unit, remaining, completeNote) ->
            if (completeNote.length > 2000) "Máximo 2,000 caracteres entre comentarios y notas."
            else "Completa producto, unidad y una cantidad válida."
        department !in productDepartments -> "Selecciona el departamento."
        concept !in productConcepts -> "Selecciona el concepto."
        kind == ProductIncidentKind.SHORTAGE_WAREHOUSE && warehouseReason.isEmpty() -> "Selecciona el motivo desde bodega."
        saved == null && !productPhotosValid(kind, photos.size) -> "Agrega al menos una foto de evidencia."
        photos.any { it !in readyPhotos } -> "Espera la vista previa o quita la foto que no se pudo leer."
        cameraPath != null -> "Termina la captura de la foto."
        else -> ""
    }
    ServiceFormSurface(::dismiss, compact = true, header = {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(if (line == null) kind.label.uppercase() else "INCIDENCIA DE PRODUCTO", style = MaterialTheme.typography.labelSmall, color = DriverColors.lime)
                Text(order.name, style = MaterialTheme.typography.titleMedium)
                Text(stop.customer, style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
            }
            AppIconButton(DriverIcon.CLOSE, "Cerrar incidencia de producto", enabled = !state.busy && cameraPath == null, onClick = ::dismiss)
        }
    }, footer = {
        if (missing.isNotBlank()) Text(missing, style = MaterialTheme.typography.bodySmall, color = DriverColors.muted, modifier = Modifier.padding(bottom = 6.dp))
        if (state.pending) AppAction("Verificar envío", DriverIcon.REFRESH, Modifier.fillMaxWidth(), enabled = !state.busy, onClick = model::retry)
        else if (saved != null && !changed) AppAction("Incidencia enviada", DriverIcon.CHECK, Modifier.fillMaxWidth(), enabled = false) {}
        else AppAction("Guardar incidencia", DriverIcon.CHECK, Modifier.fillMaxWidth(), enabled = available && missing.isEmpty()) {
            val amount = productQuantity(quantity)!!.stripTrailingZeros().toPlainString()
            if (saved == null) model.reportProduct(stop.id, order.id, lineIndex, kind, amount, product, unit, note,
                warehouseReason.takeIf { kind == ProductIncidentKind.SHORTAGE_WAREHOUSE }, department, concept, comments.toList(), photos.map(::File))
            else model.amendProduct(stop.id, order.id, saved, kind, amount, product, unit, note,
                warehouseReason.takeIf { kind == ProductIncidentKind.SHORTAGE_WAREHOUSE }, department, concept, comments.toList())
        }
        if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
    }) {
        if (line == null) {
            Text("Escribe el producto que hizo falta, aunque no venga en el pedido.", style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
            OutlinedTextField(product, { product = it.take(300) }, modifier = Modifier.fillMaxWidth(),
                label = { Text("Producto faltante") }, enabled = editable, singleLine = true)
            OutlinedTextField(unit, { unit = it.take(40) }, modifier = Modifier.fillMaxWidth(),
                label = { Text("Unidad · kg, piezas, cajas…") }, enabled = editable, singleLine = true)
        } else {
            Text(line.name, style = MaterialTheme.typography.titleMedium)
            Text("En pedido: ${line.quantity} ${line.unit} · Disponible para reportar: ${remaining?.stripTrailingZeros()?.toPlainString()} ${line.unit}",
                style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
        }
        ProductSelectField("Tipo de incidencia", kindCode,
            ProductIncidentKind.entries.filter { it.manual == (line == null) }.map { it.wire to it.label }, editable) { kindCode = it }
        OutlinedTextField(quantity, { quantity = it.take(20) }, modifier = Modifier.fillMaxWidth(),
            label = { Text(if (kind == ProductIncidentKind.RETURN) "Cantidad devuelta · $unit" else "Cantidad afectada · $unit") },
            enabled = editable, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
        if (remaining != null) TextButton(enabled = editable && remaining.signum() > 0,
            onClick = { quantity = remaining.stripTrailingZeros().toPlainString() }) { Text("Usar toda la cantidad disponible") }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ProductSelectField("Departamento", department, productDepartments.map { it to it }, editable, Modifier.weight(1f)) { department = it }
            ProductSelectField("Concepto", concept, productConcepts.map { it to it }, editable, Modifier.weight(1f)) { concept = it }
        }
        if (kind == ProductIncidentKind.SHORTAGE_WAREHOUSE) ProductSelectField("Motivo desde bodega", warehouseReason,
            WarehouseReason.entries.map { it.wire to it.label }, editable) { warehouseReason = it }
        Text(if (saved != null) "Evidencia enviada · ${saved.evidenceCount} foto(s) resguardadas"
            else "Evidencia · ${photos.size}/3${if (productEvidenceRequired(kind)) " · mínimo 1" else " · opcional"}",
            style = MaterialTheme.typography.labelLarge, color = DriverColors.lime)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            photos.forEachIndexed { index, path -> key(path) {
                CapturedProductPhoto(path, index + 1, editable, { ok -> readyPhotos = if (ok) readyPhotos + path else readyPhotos - path }) {
                    photos = photos.filterNot { it == path }; readyPhotos = readyPhotos - path; discardPhoto(path)
                }
            } }
            if (saved == null && photos.size < 3) OutlinedButton(enabled = editable, modifier = Modifier.size(88.dp),
                shape = RoundedCornerShape(12.dp), contentPadding = PaddingValues(4.dp), onClick = {
            val directory = File(context.cacheDir, "incident-camera").also { it.mkdirs() }
            val file = File(directory, "incident-product-${UUID.randomUUID()}.jpg")
            cameraPath = file.absolutePath
            try { camera.launch(FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)) }
            catch (_: RuntimeException) { cameraPath = null; discardPhoto(file.absolutePath); photoError = "No se pudo abrir la cámara. Revisa que esté disponible." }
            }) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    AppIcon(DriverIcon.CAMERA, Modifier.size(24.dp))
                    Text("Agregar foto", style = MaterialTheme.typography.labelSmall)
                }
            }
        }
        if (photoError.isNotBlank()) Text(photoError, color = DriverColors.amber)
        ProductCommentChoices(comments, editable) { comments = it }
        ServiceNoteField(note, { note = it }, "Notas adicionales · opcional", editable)
        Text("${completeNote.length}/2000 caracteres · comentarios y notas", style = MaterialTheme.typography.labelSmall, color = DriverColors.muted)
        Text(if (kind == ProductIncidentKind.RETURN) "Se registra para administración. No genera todavía una devolución ni ajuste en Odoo."
            else "Se registra por separado. Confirma la atención del pedido cuando termines de revisar sus productos.",
            style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
        Text(state.message, style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
        if (saved?.status == "resolved") Text("Incidencia resuelta por administración; ya no se puede modificar.",
            style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
        if (saved != null && saved.status == "pending") TextButton(enabled = editable, onClick = { confirmCancel = true }) {
            Text("Eliminar incidencia", color = DriverColors.amber)
        }
        TextButton(enabled = !state.busy && cameraPath == null, onClick = ::dismiss) { Text("Volver al pedido") }
    }
    if (confirmCancel && saved != null) AlertDialog(onDismissRequest = { confirmCancel = false },
        title = { Text("¿Eliminar esta incidencia?") },
        text = { Text("El producto volverá a su cantidad original si no tiene otras incidencias. El registro y sus fotos se conservan en el historial.") },
        confirmButton = { TextButton(onClick = { confirmCancel = false; model.cancelProduct(stop.id, order.id, saved) }) { Text("Eliminar incidencia") } },
        dismissButton = { TextButton(onClick = { confirmCancel = false }) { Text("Conservar") } })
}
