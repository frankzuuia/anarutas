package com.five.anarutas.driver

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.awaitCancellation
import org.json.JSONObject

/** Opening/canceling this surface never writes a delivery. Only the accepted payment command does. */
@Composable
internal fun CollectionPaymentSheet(executionId: String, shipmentId: String, attention: (() -> JSONObject?)?,
    onSaved: (String) -> Unit, close: () -> Unit) {
    val context = LocalContext.current
    val credentials = remember { DeviceCredentials(context.applicationContext) }
    val model: DriverFinanceModel = viewModel(key = "collection-$executionId-$shipmentId", factory = DriverFinanceModel.factory(credentials))
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(model, lifecycle) { lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
        model.observe(); try { awaitCancellation() } finally { model.stopObserving() }
    } }
    LaunchedEffect(executionId) { model.select(executionId) }
    val state = model.state
    val order = state.detail?.getJSONArray("orders")?.objects()?.find { it.getString("shipmentId") == shipmentId }
    val payment = order?.objectOrNull("payment")
    val paymentId = collectionPaymentId(state.lastPayment, executionId, shipmentId)
        ?: payment?.optString("id")?.takeIf(String::isNotBlank)
    LaunchedEffect(paymentId) { paymentId?.let(onSaved) }
    ServiceFormSurface({ if (!state.busy && !state.pending) close() }, header = {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Cobro del pedido", style = MaterialTheme.typography.titleLarge)
                order?.let { Text("${it.getString("customer")} · ${it.getString("orderName")}", color = DriverColors.muted) }
            }
            AppIconButton(DriverIcon.CLOSE, "Cancelar cobro", enabled = !state.busy && !state.pending, onClick = close)
        }
    }) {
        if (state.message.isNotBlank()) Text(state.message, color = DriverColors.amber)
        if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (state.pending) AppAction("Verificar confirmación pendiente", DriverIcon.REFRESH, enabled = !state.busy, onClick = model::recover)
        if (order == null) {
            Text("Consultando el monto vigente…", color = DriverColors.muted)
            AppAction("Actualizar", DriverIcon.REFRESH, enabled = !state.busy, quiet = true, onClick = model::refresh)
        } else if (payment == null) PaymentCapture(order, executionId, parseDriverFinancial(order.objectOrNull("financial")), model, attention)
        TextButton(enabled = !state.busy && !state.pending, onClick = close) { Text("Cancelar") }
    }
}
