package com.five.anarutas.driver

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.Image
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
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
internal fun settlementStatusLabel(status: String) = when(status) { "pending" -> "Por recibir"; "accepted" -> "Recibida"; "rejected" -> "Rechazada"; else -> "Sin liquidar" }
@Composable
internal fun FinanceScreen(model: DriverFinanceModel, initialExecutionId: String? = null, initialShipmentId: String? = null) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(model, lifecycle) { lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
        model.observe(); try { awaitCancellation() } finally { model.stopObserving() }
    } }
    LaunchedEffect(initialExecutionId) { if (initialExecutionId != null) model.select(initialExecutionId) }
    val state = model.state
    var selectedOrder by rememberSaveable(initialExecutionId, initialShipmentId) { mutableStateOf(initialShipmentId) }
    var search by rememberSaveable(state.executionId) { mutableStateOf("") }
    var orderFilter by rememberSaveable(state.executionId) { mutableStateOf("all") }
    var orderPage by rememberSaveable(state.executionId) { mutableIntStateOf(0) }
    var showHistory by rememberSaveable(state.executionId) { mutableStateOf(false) }
    var requestShipment by rememberSaveable { mutableStateOf<String?>(null) }
    var requestRoute by rememberSaveable { mutableStateOf(false) }
    var requestRevision by rememberSaveable { mutableIntStateOf(state.receiptRevision) }
    LaunchedEffect(state.executionId) { if (state.executionId == null) { selectedOrder = null; requestShipment = null; requestRoute = false } }
    LaunchedEffect(state.receiptRevision) { if (requestRevision != state.receiptRevision) { requestShipment = null; requestRoute = false; requestRevision = state.receiptRevision } }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("Liquidación de rutas", style = MaterialTheme.typography.headlineSmall)
        if (state.message.isNotBlank()) Text(state.message, color = DriverColors.amber)
        if (state.pending) AppAction("Recuperar confirmación pendiente", DriverIcon.REFRESH, enabled = !state.busy, onClick = model::recover)
        val detail = state.detail
        if (state.executionId == null) {
            if (state.routes.none { it.optInt("payments") > 0 }) EmptyPanel("Aún no tienes pedidos para liquidar", "Aparecerán aquí automáticamente cuando completes la entrega y confirmes el cobro.")
            state.routes.filter { it.optInt("payments") > 0 }.forEach { route -> AppCard {
                Text(route.getString("label"), style = MaterialTheme.typography.titleMedium)
                Text("${route.getString("date")} · ${route.getString("vehicle")}", color = DriverColors.muted)
                Text("${route.getInt("payments")} pedidos cobrados", color = DriverColors.lime)
                AppAction("Ver pedidos y liquidación", DriverIcon.ARROW, enabled = !state.busy) { selectedOrder = null; model.select(route.getString("id")) }
            } }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                TextButton(enabled = state.page > 0 && !state.busy, onClick = { model.page(-1) }) { Text("Anterior") }
                TextButton(enabled = state.hasMore && !state.busy, onClick = { model.page(1) }) { Text("Siguiente") }
            }
        } else if (detail == null) {
            FinanceBackButton(enabled = !state.busy) { selectedOrder = null; model.select(null) }
            Text(if (state.message.isBlank()) "Cargando pedidos…" else "El detalle no está disponible. Puedes actualizar o volver a tus rutas.")
        } else {
            val route = detail.getJSONObject("route")
            FinanceRouteHeader(route.getString("label"), route.getString("date"), enabled = !state.busy) { selectedOrder = null; model.select(null) }
            FinanceMoneySummary("Por entregar a liquidación", detail.getJSONArray("outstandingTotals").objects())
            FinanceMoneySummary("Recibido por liquidación", detail.getJSONArray("acceptedTotals").objects())
            if (route.isNull("completedAt")) Text("Puedes liquidar cada pedido cobrado durante el recorrido.", color = DriverColors.muted)
            val orders = detail.getJSONArray("orders").objects().filter(::liquidationOrderVisible).sortedWith { left, right ->
                val a = left.getJSONObject("payment"); val b = right.getJSONObject("payment")
                compareCollectionReceipts(a.getString("recordedAt"), a.getString("id"), b.getString("recordedAt"), b.getString("id"))
            }
            if (orders.isEmpty()) EmptyPanel("Sin pedidos finalizados", "Los pedidos aparecerán al completar la entrega y confirmar su cobro.")
            if (orders.isNotEmpty()) {
                OutlinedTextField(search, { search = it; orderPage = 0 }, label = { Text("Buscar cliente o pedido") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("all" to "Todos", "unsettled" to "Por liquidar", "pending" to "En revisión", "accepted" to "Recibidos").forEach { (key, label) ->
                        FilterChip(selected = orderFilter == key, onClick = { orderFilter = key; orderPage = 0 }, label = { Text(label) })
                    }
                }
            }
            val filtered = orders.filter { (orderFilter == "all" || it.optString("settlementStatus") == orderFilter) &&
                (it.getString("customer") + " " + it.getString("orderName")).contains(search.trim(), ignoreCase = true) }
            val lastPage = ((filtered.size - 1) / 12).coerceAtLeast(0)
            val currentPage = orderPage.coerceAtMost(lastPage)
            if (orders.isNotEmpty()) Text("${filtered.size} pedidos", style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
            filtered.drop(currentPage * 12).take(12).forEach { order ->
                val payment = order.getJSONObject("payment")
                val method = payment.getString("method")
                key(order.getString("shipmentId")) {
                    CompactFinanceOrderCard(customer = order.getString("customer"), orderName = order.getString("orderName"),
                        status = settlementStatusLabel(order.optString("settlementStatus")), method = method,
                        amount = paymentMoney(payment, if (method == "credit") "expected" else "received"),
                        split = if (method == "mixed") "Efectivo: ${paymentMoney(payment, "cashReceived")} · Transferencia: ${paymentMoney(payment, "transferReceived")}" else null,
                        enabled = !state.busy && !state.pending, onOpen = { selectedOrder = order.getString("shipmentId") },
                        onLiquidate = if (order.optString("settlementStatus") == "unsettled") ({ requestShipment = order.getString("shipmentId"); requestRoute = false }) else null)
                }
            }
            orders.find { it.getString("shipmentId") == selectedOrder }?.let { order ->
                ServiceFormSurface(onDismiss = { selectedOrder = null }, header = {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Column(Modifier.weight(1f)) { Text(order.getString("orderName"), color = DriverColors.lime, style = MaterialTheme.typography.labelLarge); Text(order.getString("customer"), style = MaterialTheme.typography.titleLarge) }
                        AppIconButton(DriverIcon.CLOSE, "Cerrar detalle del pedido", onClick = { selectedOrder = null })
                    }
                }, footer = {
                    if (order.optString("settlementStatus") == "unsettled") AppAction("Liquidar", DriverIcon.CHECK, Modifier.fillMaxWidth(), enabled = !state.busy && !state.pending, accent = DriverColors.amber) {
                        selectedOrder = null; requestShipment = order.getString("shipmentId"); requestRoute = false
                    }
                    AppAction("Cerrar detalle", DriverIcon.CLOSE, Modifier.fillMaxWidth(), quiet = true) { selectedOrder = null }
                }) {
                    FinanceOrderDetail(order, route.getString("id"), model)
                }
            }
            if (filtered.size > 12) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(enabled = currentPage > 0, onClick = { orderPage = currentPage - 1 }) { Text("Anterior") }
                Text("${currentPage + 1} / ${lastPage + 1}")
                TextButton(enabled = currentPage < lastPage, onClick = { orderPage = currentPage + 1 }) { Text("Siguiente") }
            }
            val eligible = orders.any { it.objectOrNull("payment") != null && it.optString("settlementStatus") == "unsettled" }
            if (!route.isNull("completedAt") && eligible) AppAction("Liquidar toda la ruta", DriverIcon.CHECK, Modifier.fillMaxWidth(), enabled = !route.isNull("completedAt") && eligible && !state.busy && !state.pending) {
                requestRoute = true; requestShipment = null
            }
            if (detail.getJSONArray("requests").length() > 0) TextButton(onClick = { showHistory = !showHistory }) { Text(if (showHistory) "Ocultar historial" else "Ver historial de liquidación") }
            if (showHistory) detail.getJSONArray("requests").objects().forEach { request -> AppCard {
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
                        Text("${paymentMethodLabel(p.getString("method"))} · ${paymentMoney(p, if (p.getString("method") == "credit") "expected" else "received")}")
                    }
                } },
                confirmButton = { TextButton(enabled = !state.busy && !state.pending, onClick = { model.submit(route.getString("id"), "requests", JSONObject().put("shipmentId", requestShipment ?: JSONObject.NULL)) }) { Text("Aceptar") } },
                dismissButton = { TextButton(enabled = !state.busy, onClick = { requestRoute = false; requestShipment = null }) { Text("Cancelar") } })
        }
    }
}
@Composable
private fun FinanceMoneySummary(title: String, totals: List<JSONObject>) {
    if (totals.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall)
        totals.forEach { total ->
            val currency = financeCurrency(total.getJSONObject("currency"))
            FinanceMethodTiles(total.getString("cash"), total.getString("transfer"), total.getString("credit"), currency)
            if (total.getString("balance").toBigDecimal().signum() != 0) Text("Pago parcial pendiente del cliente: ${financialMoney(total.getString("balance"), currency)}", style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
            if (total.getString("deferred").toBigDecimal().signum() != 0) Text("Por cobrar al entregar reposiciones: ${financialMoney(total.getString("deferred"), currency)}", style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
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
    if (payment != null) Text(paymentMethodLabel(payment.getString("method")), color = DriverColors.muted, style = MaterialTheme.typography.bodySmall)
    Text("Pedido completo · ${financial?.lines?.size ?: 0} ${if (financial?.lines?.size == 1) "partida" else "partidas"}", style = MaterialTheme.typography.titleSmall)
    financial?.lines?.forEach { line -> Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(lines.getOrNull(line.lineIndex)?.optString("name") ?: "Partida ${line.lineIndex + 1}", style = MaterialTheme.typography.titleSmall)
        Text("Cantidad final: ${liquidationQuantityText(line)} ${line.unit} · ${financialMoney(line.unitPrice, financial.currency)} / ${line.unit}", style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
        if (line.discount.toBigDecimal().signum() != 0) Text("Descuento del pedido: ${productQuantityText(line.discount)}%", style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
        FinanceReceiptValue("Original", financialMoney(line.total, financial.currency))
        if (line.net != null && line.net.toBigDecimal().compareTo(line.total.toBigDecimal()) != 0)
            FinanceReceiptValue("Final", financialMoney(line.net, financial.currency))
        HorizontalDivider(color = DriverColors.line)
    } }
    financial?.totals?.let { totals -> Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        FinanceReceiptValue("Total original", financialMoney(totals.original, financial.currency))
        if (totals.deduction.toBigDecimal().signum() != 0) FinanceReceiptValue("Devoluciones y faltantes", "− ${financialMoney(totals.deduction, financial.currency)}", deduction = true)
        if (totals.deferred.toBigDecimal().signum() != 0) FinanceReceiptValue("Reposiciones por cobrar después", "− ${financialMoney(totals.deferred, financial.currency)}")
        HorizontalDivider(color = DriverColors.line)
        FinanceReceiptValue("Total final", financialMoney(totals.net, financial.currency))
        if (payment != null) {
            val credit = payment.getString("method") == "credit"
            FinanceReceiptValue(if (credit) "Total a crédito" else "Total cobrado", paymentMoney(payment, if (credit) "expected" else "received"), emphasis = true)
            if (payment.getString("method") == "mixed") Text("Efectivo ${paymentMoney(payment, "cashReceived")} · Transferencia ${paymentMoney(payment, "transferReceived")}", style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
            if (payment.getString("balance").toBigDecimal().signum() != 0) Text("${if (credit) "Crédito" else "Saldo"} del cliente: ${paymentMoney(payment, "balance")}", style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
        }
    } }
    if (payment == null && order.getString("status") == "delivered") PaymentCapture(order, executionId, financial, model)
    if (source.getJSONArray("incidents").length() > 0) {
        HorizontalDivider(color = DriverColors.line)
        Text("Devoluciones e incidencias", style = MaterialTheme.typography.titleSmall, color = DriverColors.amber)
    }
    source.getJSONArray("incidents").objects().forEach { incident ->
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        val amount = order.optJSONObject("incidentDisplay")?.optJSONArray("amounts")?.objects()?.find { it.getString("id") == incident.getString("id") }
        FinanceReceiptValue("${incident.getString("product")} · ${productQuantityText(incident.getString("quantity"))} ${incident.getString("unit")}",
            if (amount == null || amount.isNull("deduction")) "Descuento por revisar" else if (amount.getString("deduction").toBigDecimal().signum() == 0) "Sin descuento" else "− ${financialMoney(amount.getString("deduction"), financial?.currency)}", deduction = true)
        val kind = ProductIncidentKind.entries.firstOrNull { it.wire == incident.getString("kind") }?.label ?: incident.getString("kind")
        Text(buildString { append(kind); if (incident.getString("status") == "canceled") append(" · Cancelada"); if (!incident.isNull("note") && incident.getString("note").isNotBlank()) append(" · ${incident.getString("note")}") }, style = MaterialTheme.typography.bodySmall, color = DriverColors.amber)
        if (amount != null && !amount.isNull("deferred") && amount.getString("deferred").toBigDecimal().signum() != 0) Text("Por cobrar al entregar la reposición: ${financialMoney(amount.getString("deferred"), financial?.currency)}", color = DriverColors.amber)
        if (!incident.isNull("replacement_payment")) Text(if (incident.getString("replacement_payment") == "pay_full") "Reposición: cliente paga completo" else "Reposición: se pagará al entregar", color = DriverColors.muted)
        val photos = buildList {
            if (!incident.isNull("evidence_id")) add(incident.getString("evidence_id"))
            val extras = incident.getJSONArray("evidence_ids")
            for (index in 0 until extras.length()) add(extras.getString(index))
        }.distinct()
        photos.forEachIndexed { index, photo -> FinanceEvidence(executionId, incident.getString("id"), photo, index + 1) }
        }
    }
    val incidentDisplay = order.optJSONObject("incidentDisplay")
    listOf("deductionRounding" to "Redondeo incluido en las devoluciones", "deferredRounding" to "Redondeo de reposiciones").forEach { (key, label) ->
        if (incidentDisplay != null && !incidentDisplay.isNull(key) && incidentDisplay.getString(key).toBigDecimal().signum() != 0)
            Text("$label: ${financialMoney(incidentDisplay.getString(key), financial?.currency)}", style = MaterialTheme.typography.bodySmall, color = DriverColors.amber)
    }
    if (payment != null) {
        if (payment.getString("change").toBigDecimal().signum() > 0) Text("Cambio del recibo anterior: ${paymentMoney(payment, "change")}", color = DriverColors.muted)
        if (payment.getString("note").isNotBlank()) {
            Text("Notas del chofer", style = MaterialTheme.typography.titleSmall)
            Text(payment.getString("note"), style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
        }
    }
}
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FinanceReceiptValue(label: String, value: String, emphasis: Boolean = false, deduction: Boolean = false) {
    val color = if (deduction) DriverColors.amber else MaterialTheme.colorScheme.onSurface
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, modifier = Modifier.padding(end = 12.dp), color = color, style = MaterialTheme.typography.bodyMedium)
        Text(value, color = color, style = if (emphasis) MaterialTheme.typography.headlineSmall else MaterialTheme.typography.titleSmall)
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
            Text(if (method == "credit") "Registra a crédito ${financial?.totals?.net?.let { financialMoney(it, financial.currency) }}."
                else "Recibe ${preview?.tendered?.toPlainString()?.let { financialMoney(it, financial?.currency) }} por ${paymentMethodLabel(method)}.")
            if (method == "mixed") Text("Efectivo: ${preview?.cash?.toPlainString()?.let { financialMoney(it, financial?.currency) }} · Transferencia: ${preview?.transfer?.toPlainString()?.let { financialMoney(it, financial?.currency) }}")
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
@Composable
internal fun FinanceSheet(executionId: String, shipmentId: String, close: () -> Unit) {
    val context = LocalContext.current
    val credentials = remember { DeviceCredentials(context.applicationContext) }
    val model: DriverFinanceModel = viewModel(key = "finance-detail-$executionId", factory = DriverFinanceModel.factory(credentials))
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(model, lifecycle) { lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
        model.observe(); try { awaitCancellation() } finally { model.stopObserving() }
    } }
    LaunchedEffect(executionId) { model.select(executionId) }
    val order = model.state.detail?.getJSONArray("orders")?.objects()?.find { it.getString("shipmentId") == shipmentId && liquidationOrderVisible(it) }
    ServiceFormSurface(onDismiss = close, header = {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column(Modifier.weight(1f)) { Text(order?.optString("orderName") ?: "Pedido y cobro", color = DriverColors.lime); Text(order?.optString("customer").orEmpty(), style = MaterialTheme.typography.titleLarge) }
            AppIconButton(DriverIcon.CLOSE, "Cerrar detalle del pedido", onClick = close)
        }
    }, footer = { AppAction("Cerrar detalle", DriverIcon.CLOSE, Modifier.fillMaxWidth(), quiet = true, onClick = close) }) {
        if (order != null) FinanceOrderDetail(order, executionId, model)
        else Text(if (model.state.message.isNotBlank()) model.state.message else "Esperando el pedido finalizado y su cobro…", color = DriverColors.muted)
        if (order == null) AppAction("Actualizar", DriverIcon.REFRESH, quiet = true, onClick = model::refresh)
    }
}
