package com.five.anarutas.driver

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.Image
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

internal fun paymentMethodLabel(method: String) = when (method) { "cash" -> "Efectivo"; "transfer" -> "Transferencia"; "credit" -> "Crédito"; "mixed" -> "Efectivo + transferencia"; else -> method }
internal fun settlementStatusLabel(status: String) = when(status) { "pending" -> "Por recibir"; "accepted" -> "Aceptada"; "rejected" -> "Rechazada"; else -> "Sin liquidar" }
@Composable
internal fun FinanceScreen(initialExecutionId: String? = null, initialShipmentId: String? = null) {
    val context = LocalContext.current
    val credentials = remember { DeviceCredentials(context.applicationContext) }
    val model: DriverFinanceModel = viewModel(key = "driver-finance", factory = DriverFinanceModel.factory(credentials))
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(model, lifecycle) { lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
        model.observe(); try { awaitCancellation() } finally { model.stopObserving() }
    } }
    LaunchedEffect(initialExecutionId) { if (initialExecutionId != null) model.select(initialExecutionId) }
    val state = model.state
    var selectedOrder by rememberSaveable(initialExecutionId, initialShipmentId) { mutableStateOf(initialShipmentId) }
    var requestShipment by rememberSaveable { mutableStateOf<String?>(null) }
    var requestRoute by rememberSaveable { mutableStateOf(false) }
    var requestRevision by rememberSaveable { mutableIntStateOf(state.receiptRevision) }
    LaunchedEffect(state.receiptRevision) { if (requestRevision != state.receiptRevision) { requestShipment = null; requestRoute = false; requestRevision = state.receiptRevision } }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("Liquidación de rutas", style = MaterialTheme.typography.headlineSmall)
        if (state.message.isNotBlank()) Text(state.message, color = DriverColors.amber)
        if (state.pending) AppAction("Recuperar confirmación pendiente", DriverIcon.REFRESH, enabled = !state.busy, onClick = model::recover)
        AppAction("Actualizar", DriverIcon.REFRESH, quiet = true, enabled = !state.busy, onClick = model::refresh)
        val detail = state.detail
        if (state.executionId == null) {
            if (state.routes.isEmpty()) EmptyPanel("Sin recorridos iniciados", "Aquí aparecerán tus cobros y liquidaciones.")
            state.routes.forEach { route -> AppCard {
                Text(route.getString("label"), style = MaterialTheme.typography.titleMedium)
                Text("${route.getString("date")} · ${route.getString("vehicle")}", color = DriverColors.muted)
                Text("${route.getInt("payments")}/${route.getInt("delivered")} cobros registrados")
                AppAction("Ver pedidos y liquidación", DriverIcon.ARROW, enabled = !state.busy) { selectedOrder = null; model.select(route.getString("id")) }
            } }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                TextButton(enabled = state.page > 0 && !state.busy, onClick = { model.page(-1) }) { Text("Anterior") }
                TextButton(enabled = state.hasMore && !state.busy, onClick = { model.page(1) }) { Text("Siguiente") }
            }
        } else if (detail == null) {
            TextButton(onClick = { selectedOrder = null; model.select(null) }, enabled = !state.busy) { Text("Volver a mis rutas") }
            Text(if (state.message.isBlank()) "Cargando pedidos…" else "El detalle no está disponible. Puedes actualizar o volver a tus rutas.")
        } else {
            val route = detail.getJSONObject("route")
            TextButton(onClick = { selectedOrder = null; model.select(null) }, enabled = !state.busy) { Text("Volver a mis rutas") }
            Text("${route.getString("label")} · ${route.getString("date")}", style = MaterialTheme.typography.titleMedium)
            FinanceMoneySummary("Pendiente de entregar", detail.getJSONArray("outstandingTotals").objects())
            FinanceMoneySummary("Ya aceptado", detail.getJSONArray("acceptedTotals").objects())
            if (route.isNull("completedAt")) Text("Puedes liquidar cada pedido cobrado durante el recorrido.", color = DriverColors.muted)
            val orders = detail.getJSONArray("orders").objects()
            orders.forEach { order ->
                val payment = order.objectOrNull("payment")
                AppCard {
                    TextButton(onClick = { selectedOrder = if (selectedOrder == order.getString("shipmentId")) null else order.getString("shipmentId") }) {
                        Text("${order.getString("customer")} · ${order.getString("orderName")}", style = MaterialTheme.typography.titleMedium)
                    }
                    if (payment == null) Text(if (order.getString("status") == "delivered") "Cobro por registrar" else "Pedido aún sin entrega", color = DriverColors.amber)
                    else {
                        PaymentMoneyCard(payment)
                        Text(settlementStatusLabel(order.optString("settlementStatus")), color = DriverColors.muted)
                    }
                    AppAction(if (selectedOrder == order.getString("shipmentId")) "Cerrar detalle" else "Ver pedido y cobro", DriverIcon.ORDERS, quiet = true) {
                        selectedOrder = if (selectedOrder == order.getString("shipmentId")) null else order.getString("shipmentId")
                    }
                    if (selectedOrder == order.getString("shipmentId")) FinanceOrderDetail(order, route.getString("id"), model)
                    if (payment != null && order.optString("settlementStatus") == "unsettled") AppAction("Liquidar", DriverIcon.CHECK,
                        Modifier.fillMaxWidth(), enabled = !state.busy && !state.pending, accent = DriverColors.amber) { requestShipment = order.getString("shipmentId"); requestRoute = false }
                }
            }
            val eligible = orders.any { it.objectOrNull("payment") != null && it.optString("settlementStatus") == "unsettled" }
            AppAction("Liquidar toda la ruta", DriverIcon.CHECK, Modifier.fillMaxWidth(), enabled = !route.isNull("completedAt") && eligible && !state.busy && !state.pending) {
                requestRoute = true; requestShipment = null
            }
            detail.getJSONArray("requests").objects().forEach { request -> AppCard {
                Text("${if (request.getString("scope") == "route") "Toda la ruta" else "Por pedido"} · ${settlementStatusLabel(request.getString("status"))}", style = MaterialTheme.typography.titleMedium)
                FinanceMoneySummary("Solicitud", request.getJSONArray("totals").objects())
                Text(request.getString("requestedAt"), style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
                if (!request.isNull("receiver")) Text("${request.getString("receiver")} · ${request.optString("note")}")
            } }
            if (requestRoute || requestShipment != null) AlertDialog(onDismissRequest = { if (!state.busy) { requestRoute = false; requestShipment = null } },
                title = { Text(if (requestRoute) "¿Liquidar toda la ruta pendiente?" else "¿Solicitar liquidación del pedido?") },
                text = { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("El liquidador revisará y confirmará la recepción. Transferencias y créditos no se entregan en efectivo.")
                    if (requestRoute) FinanceMoneySummary("Pendiente", detail.getJSONArray("outstandingTotals").objects())
                    else orders.find { it.getString("shipmentId") == requestShipment }?.let { o ->
                        Text("${o.getString("customer")} · ${o.getString("orderName")}")
                        val p = o.getJSONObject("payment")
                        Text("${paymentMethodLabel(p.getString("method"))} · ${p.getString(if (p.getString("method") == "credit") "expected" else "received")} ${p.getJSONObject("currency").getString("name")}")
                    }
                } },
                confirmButton = { TextButton(enabled = !state.busy && !state.pending, onClick = { model.submit(route.getString("id"), "requests", JSONObject().put("shipmentId", requestShipment ?: JSONObject.NULL)) }) { Text("Aceptar") } },
                dismissButton = { TextButton(enabled = !state.busy, onClick = { requestRoute = false; requestShipment = null }) { Text("Cancelar") } })
        }
    }
}
@Composable
internal fun PaymentMoneyCard(payment: JSONObject) {
    val method = payment.getString("method")
    Surface(color = DriverColors.lime.copy(alpha = .09f), shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, DriverColors.lime.copy(alpha = .4f)), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(if (method == "credit") "Importe a crédito" else "Monto a entregar", color = DriverColors.lime, style = MaterialTheme.typography.labelLarge)
            Text("${payment.getString(if (method == "credit") "expected" else "received")} ${payment.getJSONObject("currency").getString("name")}",
                color = DriverColors.lime, style = MaterialTheme.typography.headlineSmall)
            Text(paymentMethodLabel(method), style = MaterialTheme.typography.titleSmall)
            if (method == "mixed") Text("Efectivo: ${payment.getString("cashReceived")} · Transferencia: ${payment.getString("transferReceived")}",
                style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
        }
    }
}
@Composable
private fun FinanceMoneySummary(title: String, totals: List<JSONObject>) {
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall)
        if (totals.isEmpty()) Text("Sin importes registrados", color = DriverColors.muted)
        totals.forEach { total ->
            val currency = total.getJSONObject("currency").getString("name")
            Text("Efectivo: ${total.getString("cash")} $currency", color = DriverColors.lime)
            Text("Transferencias: ${total.getString("transfer")} $currency", color = DriverColors.blue)
            Text("Créditos: ${total.getString("credit")} $currency", color = DriverColors.purple)
            Text("Saldo pendiente: ${total.getString("balance")} · Reposición diferida: ${total.getString("deferred")} $currency", style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
        }
    }
}
@Composable
private fun FinanceOrderDetail(order: JSONObject, executionId: String, model: DriverFinanceModel) {
    val payment = order.objectOrNull("payment")
    val source = payment?.getJSONObject("snapshot") ?: order
    val financial = remember(source.toString()) { parseDriverFinancial(source.objectOrNull("financial")) }
    val lines = source.objectOrNull("order")?.optJSONArray("lines")?.objects().orEmpty()
    if (order.optBoolean("changedAfterPayment")) Text("La fuente cambió después del cobro. Se conserva el detalle confirmado.", color = DriverColors.amber)
    financial?.lines?.forEach { line -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(lines.getOrNull(line.lineIndex)?.optString("name") ?: "Partida ${line.lineIndex + 1}")
        Text("${line.quantity} ${line.unit}", color = DriverColors.lime)
        FinancialLineDetails(line, financial.currency)
    } }
    FinancialOrderSummary(financial)
    if (payment != null) {
        Text("Cobro confirmado · ${paymentMethodLabel(payment.getString("method"))}", style = MaterialTheme.typography.titleMedium)
        Text("Recibido: ${payment.getString("received")} · Saldo: ${payment.getString("balance")}")
        if (payment.getString("change").toBigDecimal().signum() > 0) Text("Cambio del recibo anterior: ${payment.getString("change")}", color = DriverColors.muted)
        Text(payment.getString("note").ifBlank { "Sin notas" }, color = DriverColors.muted)
    } else if (order.getString("status") == "delivered") PaymentCapture(order, executionId, financial, model)
    Text("Incidencias", style = MaterialTheme.typography.titleSmall)
    if (source.getJSONArray("incidents").length() == 0) Text("Sin incidencias registradas", color = DriverColors.muted)
    source.getJSONArray("incidents").objects().forEach { incident ->
        Text("${ProductIncidentKind.entries.firstOrNull { it.wire == incident.getString("kind") }?.label ?: incident.getString("kind")} · ${incident.getString("product")} · ${incident.getString("quantity")} ${incident.getString("unit")}", color = DriverColors.amber)
        Text(when (incident.getString("status")) { "open" -> "Abierta"; "pending" -> "Pendiente"; "resolved" -> "Resuelta"; "canceled" -> "Cancelada"; else -> incident.getString("status") }, style = MaterialTheme.typography.bodySmall)
        if (!incident.isNull("replacement_payment")) Text(if (incident.getString("replacement_payment") == "pay_full") "Reposición: cliente paga completo" else "Reposición: se pagará al entregar", color = DriverColors.muted)
        if (!incident.isNull("note")) Text(incident.getString("note"), style = MaterialTheme.typography.bodySmall)
        val photos = buildList {
            if (!incident.isNull("evidence_id")) add(incident.getString("evidence_id"))
            val extras = incident.getJSONArray("evidence_ids")
            for (index in 0 until extras.length()) add(extras.getString(index))
        }.distinct()
        photos.forEachIndexed { index, photo -> FinanceEvidence(executionId, incident.getString("id"), photo, index + 1) }
    }
}
@Composable
private fun FinanceEvidence(executionId: String, incidentId: String, photoId: String, index: Int) {
    val context = LocalContext.current
    var show by remember(photoId) { mutableStateOf(false) }
    var attempt by remember(photoId) { mutableIntStateOf(0) }
    var bitmap by remember(photoId) { mutableStateOf<ImageBitmap?>(null) }
    var error by remember(photoId) { mutableStateOf("") }
    LaunchedEffect(show, photoId, attempt) {
        if (show) try {
            error = ""
            bitmap = withContext(Dispatchers.IO) {
                val access = DeviceCredentials(context.applicationContext).load()
                val bytes = DriverApi(BuildConfig.SERVER_URL).financeEvidence(access.token, executionId, incidentId, photoId)
                checkNotNull(android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)).asImageBitmap()
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = friendlyError(failure) }
    }
    TextButton(onClick = { show = !show }) { Text(if (show) "Cerrar foto $index" else "Ver foto $index") }
    if (show) {
        if (error.isNotBlank()) { Text(error, color = DriverColors.amber); TextButton(onClick = { attempt++ }) { Text("Reintentar foto") } }
        else if (bitmap == null) Text("Cargando foto…")
        bitmap?.let { Image(it, "Evidencia de la incidencia, foto $index", Modifier.fillMaxWidth().heightIn(max = 280.dp)) }
    }
}
@Composable
internal fun PaymentCapture(order: JSONObject, executionId: String, financial: DriverFinancialView?, model: DriverFinanceModel,
    attention: (() -> JSONObject?)? = null) {
    val shipmentId = order.getString("shipmentId")
    var method by rememberSaveable(shipmentId) { mutableStateOf("") }
    var cash by rememberSaveable(shipmentId) { mutableStateOf("") }
    var transfer by rememberSaveable(shipmentId) { mutableStateOf("") }
    var note by rememberSaveable(shipmentId) { mutableStateOf("") }
    var basis by rememberSaveable(shipmentId) { mutableStateOf(order.getString("basis")) }
    var confirm by rememberSaveable(shipmentId) { mutableStateOf(false) }
    val state = model.state
    val changed = basis != order.getString("basis")
    val fresh = financialFresh(financial, financialClock())
    val ready = financial?.status == "ready" && financial.totals != null && financial.issues.isEmpty() && fresh
    val preview = collectionPaymentPreview(method, cash, transfer, financial?.totals?.net, financial?.currency?.rounding)
    val valid = preview != null
    val active = attention == null || attention() != null
    Text("Monto a recibir", style = MaterialTheme.typography.titleMedium)
    Text(financial?.totals?.net?.let { financialMoney(it, financial.currency) } ?: "Por confirmar",
        color = DriverColors.lime, style = MaterialTheme.typography.headlineMedium)
    if (!ready) Text("Esperando importes vigentes de Odoo.", color = DriverColors.amber)
    if (changed) {
        Text("Los importes cambiaron. Revisa el pedido antes de confirmar.", color = DriverColors.amber)
        TextButton(onClick = { basis = order.getString("basis"); confirm = false }) { Text("Revisé los importes actualizados") }
    }
    PaymentMethodPicker(method, !state.busy && !state.pending) { method = it }
    if (method == "mixed") CombinedPaymentFields(cash, transfer, !state.busy && !state.pending, { cash = it }, { transfer = it })
    if (method == "credit") Text("El importe queda a crédito; no se registra dinero recibido.", color = DriverColors.purple)
    if (method == "mixed" && !valid && ready) Text("Completa ambos importes; su suma debe ser el monto a recibir.", color = DriverColors.amber)
    OutlinedTextField(note, { note = it.take(2000) }, label = { Text("Notas del chofer · opcionales") }, modifier = Modifier.fillMaxWidth(), enabled = !state.busy && !state.pending)
    AppAction("Confirmar cobro", DriverIcon.CHECK, Modifier.fillMaxWidth(), enabled = ready && !changed && valid && active && !state.busy && !state.pending) { confirm = true }
    if (confirm) AlertDialog(onDismissRequest = { if (!state.busy) confirm = false }, title = { Text("¿Confirmar el cobro?") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(if (method == "credit") "Registra a crédito ${financial?.totals?.net} ${financial?.currency?.name}."
                else "Recibe ${preview?.tendered?.toPlainString()} ${financial?.currency?.name} por ${paymentMethodLabel(method)}.")
            if (method == "mixed") Text("Efectivo: ${preview?.cash?.toPlainString()} · Transferencia: ${preview?.transfer?.toPlainString()}")
            Text(if (attention != null) "Al aceptar se guarda el cobro y se cierra este pedido." else "Se guardará el cobro pendiente de este pedido.")
        } },
        confirmButton = { TextButton(enabled = ready && !changed && valid && active && !state.busy && !state.pending, onClick = {
            val amounts = preview ?: return@TextButton
            val payload = JSONObject().put("shipmentId", shipmentId).put("basis", basis).put("method", method).put("captureVersion", 2)
                .put("tendered", amounts.tendered.toPlainString()).put("change", "0").put("note", note)
            if (method == "mixed") payload.put("cashReceived", amounts.cash.toPlainString()).put("transferReceived", amounts.transfer.toPlainString())
            if (attention != null) payload.put("attention", attention() ?: return@TextButton)
            model.submit(executionId, "payments", payload)
        }) { Text("Aceptar") } }, dismissButton = { TextButton(enabled = !state.busy, onClick = { confirm = false }) { Text("Cancelar") } })
}
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FinanceSheet(executionId: String, shipmentId: String, close: () -> Unit) {
    ModalBottomSheet(onDismissRequest = close) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp).navigationBarsPadding()) { FinanceScreen(executionId, shipmentId) }
    }
}
