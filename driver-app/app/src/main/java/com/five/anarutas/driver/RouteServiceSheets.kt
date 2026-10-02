package com.five.anarutas.driver

import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
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
private fun ServiceFeedback(model: RouteExecutionModel) {
    val state = model.state
    Text(state.message, color = if (state.verified) DriverColors.muted else DriverColors.amber, style = MaterialTheme.typography.bodySmall)
    if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
    if (state.pending) AppAction("Verificar envío", DriverIcon.REFRESH, Modifier.fillMaxWidth(), enabled = !state.busy, onClick = model::retry)
}

@Composable
internal fun CustomerPhoneActions(stop: ExecutionStop, model: RouteExecutionModel) {
    val context = LocalContext.current
    var editing by rememberSaveable(stop.id) { mutableStateOf(false) }
    var number by rememberSaveable(stop.id) { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    val state = model.state
    val available = state.verified && !state.busy && !state.pending && !state.retired && state.execution?.completedAt == null
    if (!stop.phone.isNullOrBlank()) {
        AppAction("Llamar al cliente", DriverIcon.PHONE, Modifier.fillMaxWidth(), quiet = true) {
            try { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", stop.phone, null))) }
            catch (_: RuntimeException) { error = "Este dispositivo no tiene una aplicación para llamadas." }
        }
        Text("Teléfono operativo · ${stop.phone}", color = DriverColors.muted, style = MaterialTheme.typography.bodySmall)
    } else {
        Text("Cliente sin número registrado en la base de datos", color = DriverColors.muted, style = MaterialTheme.typography.bodySmall)
        if (!editing) AppAction("Añadir número", DriverIcon.PHONE, Modifier.fillMaxWidth(), quiet = true,
            enabled = available && stop.arrivedAt != null && !stop.customerArchived) { editing = true }
        else {
            OutlinedTextField(number, { number = it.take(80) }, modifier = Modifier.fillMaxWidth(), singleLine = true,
                label = { Text("Teléfono operativo") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), enabled = available)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                AppAction("Guardar", DriverIcon.CHECK, Modifier.weight(1f), enabled = available && number.count(Char::isDigit) in 7..15) { model.addPhone(stop.id, number) }
                TextButton(enabled = !state.busy && !state.pending, onClick = { editing = false; number = "" }) { Text("Cancelar") }
            }
        }
    }
    if (error.isNotBlank()) Text(error, color = DriverColors.amber)
}

@Composable
internal fun StopAttentionSheet(stop: ExecutionStop, route: AssignedPlan?, timezone: String,
    navigationAvailable: Boolean, alreadyGuiding: Boolean, model: RouteExecutionModel,
    onNavigate: (Boolean) -> Unit, onIncident: (String) -> Unit, close: () -> Unit) {
    val orders = route?.orders.orEmpty().filter { it.id in stop.shipmentIds }
    var selectedId by rememberSaveable(stop.id) { mutableStateOf<String?>(null) }
    var confirmation by rememberSaveable(stop.id) { mutableStateOf<String?>(null) }
    var financeOpen by rememberSaveable(stop.id) { mutableStateOf(false) }
    var collectionOpen by rememberSaveable(stop.id) { mutableStateOf(false) }
    var note by rememberSaveable(stop.id) { mutableStateOf("") }
    var productLine by rememberSaveable(stop.id) { mutableStateOf<Int?>(null) }
    var editingProductIncidentId by rememberSaveable(stop.id) { mutableStateOf<String?>(null) }
    val order = orders.find { it.id == selectedId } ?: orders.firstOrNull()
    val status = stop.orderStates.find { it.shipmentId == order?.id }
    val state = model.state
    val available = state.verified && !state.busy && !state.pending && !state.retired && state.execution?.completedAt == null
    var confirmedRevision by remember { mutableIntStateOf(state.serviceRevision) }
    LaunchedEffect(state.serviceRevision) {
        if (confirmedRevision != state.serviceRevision) { confirmation = null; note = ""; confirmedRevision = state.serviceRevision }
    }
    val editingProductIncident = stop.productIncidents.find { it.id == editingProductIncidentId && it.shipmentId == order?.id && it.status != "canceled" }
    if ((productLine != null || editingProductIncident != null) && order != null) {
        ProductIncidentSheet(stop, order, editingProductIncident?.lineIndex ?: productLine,
            ProductIncidentKind.entries.firstOrNull { it.wire == editingProductIncident?.kind }
                ?: ProductIncidentKind.REPLACEMENT_QUALITY, model, editingProductIncident) {
            productLine = null; editingProductIncidentId = null
        }
        return
    }
    if (collectionOpen && order != null && state.execution != null) {
        CollectionPaymentSheet(state.execution.id, order.id,
            if (status?.status == OrderServiceStatus.DELIVERED) null else { { model.collectionAttention(stop.id, order.id) } },
            { paymentId -> collectionOpen = false; model.collectionConfirmed(state.execution.id, stop.id, paymentId); close() }, { collectionOpen = false })
        return
    }
    if (financeOpen && order != null && state.execution != null && status?.status == OrderServiceStatus.DELIVERED) {
        FinanceSheet(state.execution.id, order.id) { financeOpen = false }
        return
    }
    ServiceFormSurface({ if (!state.busy) close() }, header = {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("PARADA ${stop.position}", style = MaterialTheme.typography.labelSmall, color = DriverColors.lime)
                Text(stop.customer, style = MaterialTheme.typography.titleLarge)
            }
            AppIconButton(DriverIcon.CLOSE, "Cerrar atención", enabled = !state.busy, onClick = close)
        }
    }) {
        if (stop.canAttend()) stop.arrivedAt?.let { StatusBadge("Llegada · ${formatRouteTime(it, timezone)}") }
        Text(stop.address, color = DriverColors.muted, style = MaterialTheme.typography.bodySmall)
        if (!stop.canAttend() && !stop.isServiceFinished()) {
            AppAction(if (stop.hasPendingRetry()) "Reintentar pedido" else if (alreadyGuiding) "Ya vas a esta parada" else "Ir a esta parada",
                if (stop.hasPendingRetry()) DriverIcon.REFRESH else DriverIcon.ROUTE, Modifier.fillMaxWidth(),
                enabled = navigationAvailable, onClick = { onNavigate(stop.hasPendingRetry() && stop.arrivedAt != null) })
            Text("La atención se habilita al confirmar una llegada en el domicilio. Consultar este punto no cambia tu destino.",
                color = DriverColors.muted, style = MaterialTheme.typography.bodySmall)
        }
        if (orders.size > 1) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            orders.forEach { item -> FilterChip(selected = item.id == order?.id, enabled = confirmation == null && !state.busy,
                onClick = { selectedId = item.id }, label = { Text(item.name) }) }
        }
        if (order == null || status == null) Text("Sincronizando detalle del pedido…", color = DriverColors.muted)
        if (order != null && status != null) {
            HorizontalDivider(color = DriverColors.line)
            SectionLabel(order.name, "${order.lines.size} partidas")
            val productCases = stop.productIncidents.filter { it.shipmentId == order.id && it.status != "canceled" }
            val hasIncidents = productCases.isNotEmpty()
            StatusBadge(if (hasIncidents && status.status == OrderServiceStatus.DELIVERED) "Atendido con incidencias" else status.status.label,
                if (status.status == OrderServiceStatus.DELIVERED) DriverColors.lime else DriverColors.amber)
            if (confirmation == null && canRetryRescheduledOrder(status.status)) {
                AppAction("Reintentar pedido", DriverIcon.REFRESH, Modifier.fillMaxWidth(), enabled = available) { confirmation = "retry" }
            }
            if (order.note.isNotBlank()) Text(order.note, color = DriverColors.amber)
            if (hasIncidents) Text("${productCases.size} incidencias activas · administración conserva el detalle", color = DriverColors.amber,
                style = MaterialTheme.typography.bodySmall)
            order.lines.forEachIndexed { index, line -> Row(Modifier.fillMaxWidth()
                .clickable(enabled = available && stop.canAttend() && canDeliverOrder(status.status),
                    onClickLabel = "Registrar incidencia de ${line.name}") { productLine = index }.heightIn(min = 44.dp).padding(vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                ProductThumbnail(line)
                if (productCases.any { it.lineIndex == index }) AppIcon(DriverIcon.ALERT, Modifier.size(18.dp), tint = DriverColors.amber)
                val financial = order.financial?.line(index)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(line.name, style = MaterialTheme.typography.bodyMedium)
                    Text("${productQuantityText(financial?.physicalRemaining ?: remainingProductQuantity(line.quantity, productCases, order.id, index).toPlainString())} ${financial?.unit ?: line.unit}",
                        color = DriverColors.lime, style = MaterialTheme.typography.labelLarge)
                    if (financial != null && financial.physicalRemaining.toBigDecimal().compareTo(financial.quantity.toBigDecimal()) != 0)
                        Text("Validado: ${productQuantityText(financial.quantity)} ${financial.unit}", style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
                    FinancialLineDetails(financial, order.financial?.currency)
                }
            } }
            FinancialOrderSummary(order.financial)
            if (status.status == OrderServiceStatus.DELIVERED) AppAction(if (status.paymentRequired && !status.paymentConfirmed) "Registrar cobro pendiente" else "Ver pedido y cobro", DriverIcon.CHECK, Modifier.fillMaxWidth()) {
                if (status.paymentRequired && !status.paymentConfirmed) collectionOpen = true else financeOpen = true
            }
            productCases.forEach { incident -> Row(Modifier.fillMaxWidth().heightIn(min = 44.dp)
                .clickable(enabled = available && stop.canAttend() && canDeliverOrder(status.status),
                    onClickLabel = "Ver incidencia de ${incident.product}") { editingProductIncidentId = incident.id }
                .padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically) {
                AppIcon(DriverIcon.ALERT, Modifier.size(16.dp), tint = DriverColors.amber)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("${ProductIncidentKind.entries.firstOrNull { it.wire == incident.kind }?.label ?: incident.kind} · ${incident.product}" +
                    when (incident.replacementPayment) { "pay_full" -> " · Paga completo"; "defer" -> " · Pago pendiente"; else -> "" },
                    style = MaterialTheme.typography.bodySmall, color = DriverColors.amber)
                val amount = order.financial?.incidentAmounts?.find { it.id == incident.id }
                Text(if (amount?.deduction == null) "Descuento pendiente de revisión" else if (amount.deduction.toBigDecimal().signum() != 0) "Descontado: − ${financialMoney(amount.deduction, order.financial?.currency)}" else "Sin descuento al cobro",
                    style = MaterialTheme.typography.labelSmall, color = DriverColors.amber)
                }
                Text("${productQuantityText(incident.quantity)} ${incident.unit}", style = MaterialTheme.typography.labelSmall, color = DriverColors.amber)
            } }
            if (confirmation == null) {
                if (canDeliverOrder(status.status) && stop.canAttend()) AppAction(if (hasIncidents) "Confirmar atención con incidencias" else "Entregado completo", DriverIcon.CHECK,
                    Modifier.fillMaxWidth(), enabled = available) { collectionOpen = true }
                if (canRescheduleRetry(status.status, stop.visitSequence, stop.closedReportedVisitSequence)) AppAction("Reprogramar", DriverIcon.CLOCK,
                    Modifier.fillMaxWidth(), enabled = available, quiet = true) { confirmation = "reschedule" }
                if (stop.canAttend() && canRejectOrder(status.status)) AppAction("Registrar incidencia", DriverIcon.ALERT,
                    Modifier.fillMaxWidth(), enabled = available, quiet = true, onClick = { onIncident(order.id) })
            } else {
                Text(if (confirmation == "retry") "Reintentar ${order.name}" else "Reprogramar ${order.name}", style = MaterialTheme.typography.titleMedium)
                Text(if (confirmation == "retry") "Este pedido volverá a abierto y aparecerá en el mapa. Confirma una nueva llegada antes de entregarlo; la reprogramación queda en el historial."
                    else "Puedes reprogramar desde donde estés; no confirma una entrega. Administración decidirá cuándo volver a asignarlo. No se fija ninguna fecha.",
                    style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
                if (confirmation == "reschedule") ServiceNoteField(note, { note = it }, "Notas de reprogramación · opcionales", available)
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    AppAction("Aceptar", DriverIcon.CHECK, Modifier.weight(1f), enabled = available) {
                        if (confirmation == "retry") model.retryRescheduled(stop.id, order.id)
                        else model.submitService(stop.id, order.id, "reschedule", note = note)
                    }
                    TextButton(enabled = !state.busy && !state.pending, onClick = { confirmation = null; note = "" }) { Text("Cancelar") }
                }
            }
        }
        CustomerPhoneActions(stop, model)
        ServiceFeedback(model)
    }
}

@Composable
internal fun ServiceIncidentSheet(stop: ExecutionStop, initialOrderId: String?, model: RouteExecutionModel, close: () -> Unit) {
    val context = LocalContext.current
    val state = model.state
    var mode by rememberSaveable(stop.id) { mutableStateOf("customer_closed") }
    var missingKind by rememberSaveable(stop.id) { mutableStateOf<String?>(null) }
    var reason by rememberSaveable(stop.id) { mutableStateOf("") }
    var note by rememberSaveable(stop.id) { mutableStateOf("") }
    var selectedId by rememberSaveable(stop.id) { mutableStateOf(initialOrderId) }
    var cameraPath by rememberSaveable(stop.id) { mutableStateOf<String?>(null) }
    var photoPath by rememberSaveable(stop.id) { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf("") }
    val orders = state.route?.orders.orEmpty().filter { order -> stop.orderStates.any { it.shipmentId == order.id && canRejectOrder(it.status) } }
    val selected = orders.find { it.id == selectedId } ?: orders.firstOrNull()
    val available = state.verified && !state.busy && !state.pending && !state.retired && state.execution?.completedAt == null && stop.canAttend()
    fun discardPhotoFile(path: String?) {
        path?.let { val file = File(it)
            if (file.canonicalFile.parentFile == File(context.cacheDir, "incident-camera").canonicalFile) file.delete()
        }
    }
    fun discardPhoto() {
        discardPhotoFile(photoPath)
        photoPath = null
    }
    DisposableEffect(model, stop.id) {
        // A saved incident may replace this form with the next-stop dialog.
        // Rotation alone must keep an unsent camera draft for rememberSaveable.
        onDispose {
            if (model.state.continuation?.stopId == stop.id) discardPhotoFile(photoPath)
        }
    }
    fun dismiss() { if (!state.busy) { discardPhoto(); close() } }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { saved ->
        val path = cameraPath; cameraPath = null
        val file = path?.let(::File)
        if (saved && file?.isFile == true && file.length() in 1..8L * 1024 * 1024) {
            discardPhoto(); photoPath = file.absolutePath; error = ""
        } else { file?.delete(); if (saved) error = "La fotografía está vacía o supera 8 MB. Tómala con menor resolución." }
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
    var confirmedRevision by remember { mutableIntStateOf(state.serviceRevision) }
    LaunchedEffect(state.serviceRevision) {
        if (confirmedRevision != state.serviceRevision) { confirmedRevision = state.serviceRevision; discardPhoto(); close() }
    }
    if (missingKind != null && selected != null) {
        ProductIncidentSheet(stop, selected, null, ProductIncidentKind.entries.first { it.wire == missingKind }, model) { missingKind = null }
        return
    }
    ServiceFormSurface(::dismiss, header = {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("REPORTAR INCIDENCIA", style = MaterialTheme.typography.labelSmall, color = DriverColors.lime)
                Text(stop.customer, style = MaterialTheme.typography.titleLarge)
            }
            AppIconButton(DriverIcon.CLOSE, "Cancelar incidencia", enabled = !state.busy, onClick = ::dismiss)
        }
    }) {
        Text("Selecciona lo que ocurrió. Se enviará a administración con tu nombre y la hora del registro.", color = DriverColors.muted)
        Column(Modifier.fillMaxWidth().selectableGroup(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            IncidentChoice.entries.forEach { choice ->
                IncidentChoiceCard(choice, mode == choice.code, incidentChoiceEnabled(choice, available, orders.isNotEmpty())) { mode = choice.code }
            }
        }
        if (mode == IncidentChoice.SHORTAGE_VALIDATION.code || mode == IncidentChoice.SHORTAGE_WAREHOUSE.code) {
            Text("Selecciona el pedido al que corresponde el producto faltante.", color = DriverColors.muted, style = MaterialTheme.typography.bodySmall)
            if (orders.size > 1) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                orders.forEach { order -> FilterChip(order.id == selected?.id, { selectedId = order.id }, enabled = available, label = { Text(order.name) }) }
            } else Text(selected?.name ?: "Sin pedidos disponibles")
            AppAction("Continuar con faltante", DriverIcon.ALERT, Modifier.fillMaxWidth(), enabled = available && selected != null) { missingKind = mode }
            ServiceFeedback(model)
            TextButton(enabled = !state.busy, onClick = ::dismiss) { Text("Volver al pedido") }
            return@ServiceFormSurface
        }
        if (mode == "customer_closed") {
            Text("Todos los pedidos sin cerrar de esta parada quedarán pendientes de reintento. Toma una foto del negocio cerrado.", color = DriverColors.amber, style = MaterialTheme.typography.bodySmall)
        } else {
            Text("Pedido rechazado", style = MaterialTheme.typography.titleMedium)
            if (orders.size > 1) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                orders.forEach { order -> FilterChip(order.id == selected?.id, { selectedId = order.id }, enabled = available, label = { Text(order.name) }) }
            } else Text(selected?.name.orEmpty())
            listOf("poor_quality" to "Mala calidad de producto", "late_arrival" to "Llegada tarde", "other" to "Otro").forEach { (code, label) ->
                FilterChip(reason == code, { reason = code }, enabled = available, label = { Text(label) }, modifier = Modifier.fillMaxWidth())
            }
            Text("Quedará rechazado, pero podrás entregarlo después si el cliente cambia de opinión.", color = DriverColors.muted, style = MaterialTheme.typography.bodySmall)
        }
        ServiceNoteField(note, { note = it }, if (mode == "reject" && reason == "other") "Describe el motivo · obligatorio" else "Comentario · opcional", available)
        if (mode == "customer_closed") {
            preview?.let { Image(it, "Evidencia capturada del negocio", Modifier.fillMaxWidth().height(180.dp), contentScale = ContentScale.Crop) }
            AppAction(if (photoPath == null) "Tomar fotografía" else "Tomar otra foto", DriverIcon.CAMERA,
                Modifier.fillMaxWidth(), quiet = true, enabled = available && cameraPath == null) {
                val directory = File(context.cacheDir, "incident-camera").also { it.mkdirs() }
                val file = File(directory, "incident-${UUID.randomUUID()}.jpg")
                cameraPath = file.absolutePath
                try { camera.launch(FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)) }
                catch (_: RuntimeException) { cameraPath = null; file.delete(); error = "No se pudo abrir la cámara. Revisa que esté disponible." }
            }
        }
        if (error.isNotBlank()) Text(error, color = DriverColors.amber)
        AppAction("Enviar incidencia", DriverIcon.ALERT, Modifier.fillMaxWidth(), enabled = available &&
            (if (mode == "customer_closed") photoPath != null && preview != null else selected != null && reason.isNotBlank() && (reason != "other" || note.isNotBlank()))) {
            if (mode == "customer_closed") model.reportClosed(stop.id, note, File(photoPath!!))
            else model.submitService(stop.id, selected!!.id, "reject", reason, note)
        }
        CustomerPhoneActions(stop, model)
        ServiceFeedback(model)
        TextButton(enabled = !state.busy, onClick = ::dismiss) { Text("Volver al pedido") }
    }
}
