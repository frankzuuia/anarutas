package com.five.anarutas.driver

import android.os.SystemClock
import androidx.compose.runtime.*
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.util.UUID
import java.io.File

internal data class ExecutionUiState(val route: AssignedPlan? = null, val execution: DriverExecution? = null,
    val loading: Boolean = true, val busy: Boolean = false, val verified: Boolean = false, val retired: Boolean = false,
    val pending: Boolean = false, val message: String = "Cargando tu ruta…", val arrivedStop: String? = null,
    val correctedStop: String? = null, val exitDestination: String? = null, val serviceRevision: Int = 0,
    val continuation: StopContinuation? = null, val productRevision: Int = 0,
    val lastProductIncidentId: String? = null, val lastProductAction: String? = null)

/** Owns network/retry state across rotation. Business facts only come from the server. */
internal class RouteExecutionModel(private val credentials: DeviceCredentials, private val planId: String,
    private val captures: IncidentCaptureStore) : ViewModel() {
    var state by mutableStateOf(ExecutionUiState())
        private set
    private val api = DriverApi(BuildConfig.SERVER_URL)
    private val gate = Mutex()
    private var pending: JSONObject? = null
    private var confirmed: JSONObject? = null
    private var recovered = false

    private suspend fun access() = withContext(Dispatchers.IO) { credentials.load() }
    private suspend fun clearPending() {
        pending?.optJSONArray("evidenceKeys")?.let { keys ->
            withContext(Dispatchers.IO) { for (index in 0 until keys.length()) captures.discard(keys.getString(index)) }
        }
        pending?.optString("evidenceKey")?.takeIf(String::isNotBlank)?.let { key ->
            withContext(Dispatchers.IO) { captures.discard(key) }
        }
        withContext(Dispatchers.IO) { credentials.clearPendingStopCommand(planId) }
        pending = null
        state = state.copy(pending = false)
    }
    private suspend fun retire(message: String) {
        clearPending()
        confirmed = null
        NavigationRegistry.endSession()
        state = ExecutionUiState(loading = false, retired = true, message = message)
    }
    private suspend fun loadLocked() {
        if (state.retired) return
        try {
            val saved = access()
            if (saved.token.isBlank()) { retire("Tu sesión terminó. Vuelve a ingresar."); return }
            val execution = api.execution(saved.token, planId)
            if (state.execution?.let { it.id != execution.id } == true) {
                retire("Administración cambió esta ruta. Abre la nueva publicación desde Inicio."); return
            }
            val route = api.plan(saved.token, planId)
            if (route.startedAt == null || route.publicationRevision != execution.publicationRevision) {
                retire("La ruta ya no está iniciada. Regresa a Inicio."); return
            }
            if (!recovered) {
                withContext(Dispatchers.IO) { captures.prune() }
                val encoded = withContext(Dispatchers.IO) { credentials.readPendingStopCommand(planId) }
                pending = encoded?.let { runCatching { JSONObject(it) }.getOrNull() }?.takeIf {
                    it.optString("deviceId") == saved.deviceId && it.optString("planId") == planId &&
                        it.optJSONObject("payload")?.optString("executionId") == execution.id
                }
                recovered = true
                if (encoded != null && pending == null) clearPending()
            }
            state = state.copy(route = route, execution = execution, verified = true, loading = false,
                pending = pending != null, message = if (state.loading) "Ruta sincronizada" else state.message)
            confirmed?.let { command ->
                // Emit UI/navigation effects only after the saved point has been re-read.
                val kind = command.getString("kind")
                state = state.copy(
                    message = when (kind) {
                        "arrival" -> "Llegada registrada. Puedes revisar el pedido."
                        "visit-exit" -> "Visita anterior finalizada. El estado de sus pedidos se conserva."
                        "service" -> when (command.getJSONObject("payload").getString("kind")) {
                            "deliver" -> "Entrega registrada. La ruta continúa pendiente de liquidación."
                            "reschedule" -> "Pedido reprogramado. Administración verá tus notas sin una fecha impuesta."
                            else -> "Rechazo registrado. Aún podrás entregarlo si el cliente cambia de opinión."
                        }
                        "closed" -> "Cliente cerrado registrado con evidencia · folio ${command.getString("incidentId").takeLast(8)}. Pedidos pendientes de reintento."
                        "order-retry" -> "Pedido reabierto. Confirma una nueva llegada para atenderlo."
                        "product-incident", "product-incident-amend" -> "Incidencia enviada. Administración ya puede consultarla."
                        "product-incident-cancel" -> "Incidencia eliminada. El historial y la evidencia quedan resguardados."
                        "phone" -> "Teléfono operativo guardado también en la ficha del cliente."
                        else -> "Punto corregido en tu ruta y en la ficha del cliente."
                    },
                    arrivedStop = command.getString("stopId").takeIf { kind == "arrival" },
                    correctedStop = command.getString("stopId").takeIf { kind == "location" },
                    exitDestination = command.optString("destinationStopId").takeIf { (kind == "visit-exit" || kind == "order-retry") && it.isNotBlank() },
                    serviceRevision = state.serviceRevision + if (kind == "service" || kind == "closed" || kind == "order-retry") 1 else 0,
                    productRevision = state.productRevision + if (kind.startsWith("product-incident")) 1 else 0,
                    lastProductIncidentId = command.optString("incidentId").takeIf { kind.startsWith("product-incident") && it.isNotBlank() },
                    lastProductAction = kind.takeIf { it.startsWith("product-incident") },
                    continuation = confirmedStopContinuation(command.getJSONObject("payload").getString("commandId"), kind,
                        command.getJSONObject("payload").optString("kind"), execution.stops.find { it.id == command.getString("stopId") }),
                )
                confirmed = null
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            if (failure is DriverApiException && failure.status in listOf(401, 404)) retire(friendlyError(failure))
            else state = state.copy(loading = false, verified = false, message = friendlyError(failure))
        }
    }
    suspend fun sync() = withContext(Dispatchers.Main.immediate) { gate.withLock { loadLocked() } }
    fun refresh() { viewModelScope.launch { sync() } }
    suspend fun observe() {
        while (currentCoroutineContext().isActive && !state.retired) {
            try {
                val saved = access()
                if (saved.token.isBlank()) { sync(); return }
                api.observeEvents(saved.token) { event ->
                    if (event == "reset" || event == "change" || event == "unauthorized") sync()
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { sync() }
            delay(5000)
        }
    }
    fun consumeArrival() { state = state.copy(arrivedStop = null) }
    fun consumeCorrection() { state = state.copy(correctedStop = null) }
    fun consumeExit() { state = state.copy(exitDestination = null) }
    fun dismissContinuation() { state = state.copy(continuation = null) }

    fun submit(stopId: String, gps: DriverGps?, corrected: ExecutionPoint?, confirmedAddress: CorrectedAddressFields? = null) {
        val execution = state.execution ?: return
        val stop = execution.stops.find { it.id == stopId } ?: return
        if (state.busy || state.pending || !state.verified || state.retired) return
        val elapsed = SystemClock.elapsedRealtime()
        if (arrivalEligibility(gps, corrected ?: stop.point, execution.policy, elapsed) != ArrivalEligibility.READY) return
        if (corrected != null && stop.customerArchived) return
        val payload = stopCommand(execution, stop, gps!!, elapsed, UUID.randomUUID().toString(), corrected, confirmedAddress)
        queueCommand(stopId, if (corrected == null) "arrival" else "location", payload)
    }
    fun exitVisit(stopId: String, destinationStopId: String) {
        val execution = state.execution ?: return
        val stop = execution.stops.find { it.id == stopId } ?: return
        if (state.busy || state.pending || !state.verified || state.retired || stop.arrivedAt == null || stop.visitSequence < 1 ||
            execution.stops.none { it.id == destinationStopId }) return
        queueCommand(stopId, "visit-exit", visitExitCommand(execution, stop, UUID.randomUUID().toString()), destinationStopId)
    }
    fun submitService(stopId: String, shipmentId: String, kind: String, reason: String? = null, note: String? = null) {
        val execution = state.execution ?: return
        val stop = execution.stops.find { it.id == stopId } ?: return
        val order = stop.orderStates.find { it.shipmentId == shipmentId } ?: return
        if (!serviceAvailable(stop) || (kind != "reschedule" && !stop.canAttend())) return
        val allowed = when (kind) {
            "deliver" -> canDeliverOrder(order.status)
            "reject" -> canRejectOrder(order.status) && reason in listOf("poor_quality", "late_arrival", "other") && (reason != "other" || !note.isNullOrBlank())
            "reschedule" -> canRescheduleOrder(order.status)
            else -> false
        }
        if (!allowed || (note?.length ?: 0) > 2000) return
        val payload = visitExitCommand(execution, stop, UUID.randomUUID().toString()).put("orderVersion", order.version)
            .put("kind", kind).put("reasonCode", reason).put("note", note)
        if (kind == "deliver" && stop.productIncidents.any { it.shipmentId == shipmentId && it.status != "canceled" }) payload.put("productIncidentsAcknowledged", true)
        queueCommand(stopId, "service", payload, shipmentId = shipmentId)
    }
    fun reportProduct(stopId: String, shipmentId: String, lineIndex: Int?, kind: ProductIncidentKind,
        quantity: String, product: String, unit: String, note: String, warehouseReason: String?, department: String,
        concept: String, comments: List<String>, photos: List<File>) {
        val execution = state.execution ?: return
        val stop = execution.stops.find { it.id == stopId } ?: return
        val order = stop.orderStates.find { it.shipmentId == shipmentId } ?: return
        if (!serviceAvailable(stop) || !stop.canAttend() || !canDeliverOrder(order.status)) return
        if (!productPhotosValid(kind, photos.size) || department !in productDepartments || concept !in productConcepts) return
        val payload = visitExitCommand(execution, stop, UUID.randomUUID().toString()).put("orderVersion", order.version)
            .put("kind", kind.wire).put("quantity", quantity).put("note", note).put("department", department)
            .put("formVersion", 2).put("concept", concept).put("comments", org.json.JSONArray(comments))
        if (warehouseReason != null) payload.put("warehouseReason", warehouseReason)
        if (lineIndex == null) payload.put("product", product).put("unit", unit) else payload.put("lineIndex", lineIndex)
        queueCommand(stopId, "product-incident", payload, shipmentId = shipmentId, productPhotos = photos)
    }
    fun amendProduct(stopId: String, shipmentId: String, incident: ProductIncidentRecord, kind: ProductIncidentKind,
        quantity: String, product: String, unit: String, note: String, warehouseReason: String?, department: String,
        concept: String, comments: List<String>) {
        val execution = state.execution ?: return
        val stop = execution.stops.find { it.id == stopId } ?: return
        val order = stop.orderStates.find { it.shipmentId == shipmentId } ?: return
        if (!serviceAvailable(stop) || !stop.canAttend() || !canDeliverOrder(order.status) || incident.status != "pending") return
        if (department !in productDepartments || concept !in productConcepts) return
        val payload = visitExitCommand(execution, stop, UUID.randomUUID().toString()).put("orderVersion", order.version)
            .put("expectedVersion", incident.version).put("kind", kind.wire).put("quantity", quantity).put("note", note)
            .put("department", department).put("formVersion", 2).put("concept", concept)
            .put("comments", org.json.JSONArray(comments))
        if (warehouseReason != null) payload.put("warehouseReason", warehouseReason)
        if (incident.lineIndex == null) payload.put("product", product).put("unit", unit) else payload.put("lineIndex", incident.lineIndex)
        queueCommand(stopId, "product-incident-amend", payload, shipmentId = shipmentId, incidentId = incident.id)
    }
    fun cancelProduct(stopId: String, shipmentId: String, incident: ProductIncidentRecord) {
        val execution = state.execution ?: return
        val stop = execution.stops.find { it.id == stopId } ?: return
        val order = stop.orderStates.find { it.shipmentId == shipmentId } ?: return
        if (!serviceAvailable(stop) || !stop.canAttend() || !canDeliverOrder(order.status) || incident.status != "pending") return
        val payload = visitExitCommand(execution, stop, UUID.randomUUID().toString()).put("orderVersion", order.version)
            .put("expectedVersion", incident.version)
        queueCommand(stopId, "product-incident-cancel", payload, shipmentId = shipmentId, incidentId = incident.id)
    }
    fun reportClosed(stopId: String, note: String, photo: File) {
        val execution = state.execution ?: return
        val stop = execution.stops.find { it.id == stopId } ?: return
        if (!serviceAvailable(stop) || !stop.canAttend() || note.length > 2000) return
        queueCommand(stopId, "closed", visitExitCommand(execution, stop, UUID.randomUUID().toString()).put("note", note), capture = photo)
    }
    fun retryRescheduled(stopId: String, shipmentId: String) {
        val execution = state.execution ?: return
        val stop = execution.stops.find { it.id == stopId } ?: return
        val order = stop.orderStates.find { it.shipmentId == shipmentId } ?: return
        if (!state.verified || state.busy || state.pending || state.retired || !canRetryRescheduledOrder(order.status)) return
        queueCommand(stopId, "order-retry", visitExitCommand(execution, stop, UUID.randomUUID().toString()).put("orderVersion", order.version),
            destinationStopId = stopId, shipmentId = shipmentId)
    }
    fun addPhone(stopId: String, phone: String) {
        val execution = state.execution ?: return
        val stop = execution.stops.find { it.id == stopId } ?: return
        if (!serviceAvailable(stop) || !stop.phone.isNullOrBlank() || stop.customerArchived) return
        queueCommand(stopId, "phone", visitExitCommand(execution, stop, UUID.randomUUID().toString())
            .put("phone", phone).put("customerVersion", stop.customerVersion))
    }
    private fun serviceAvailable(stop: ExecutionStop) = state.verified && !state.retired && !state.busy && !state.pending && stop.arrivedAt != null
    private fun queueCommand(stopId: String, kind: String, payload: JSONObject, destinationStopId: String? = null,
        shipmentId: String? = null, capture: File? = null, productPhotos: List<File> = emptyList(), incidentId: String? = null) {
        state = state.copy(busy = true, message = "Confirmando con el servidor…")
        viewModelScope.launch {
            gate.withLock {
                try {
                    val saved = access()
                    pending = JSONObject().put("deviceId", saved.deviceId).put("planId", planId)
                        .put("stopId", stopId).put("kind", kind).put("payload", payload)
                    if (destinationStopId != null) pending!!.put("destinationStopId", destinationStopId)
                    if (shipmentId != null) pending!!.put("shipmentId", shipmentId)
                    if (incidentId != null) pending!!.put("incidentId", incidentId)
                    if (capture != null) pending!!.put("evidenceKey", withContext(Dispatchers.IO) { captures.stage(capture) })
                    if (productPhotos.isNotEmpty()) pending!!.put("evidenceKeys",
                        org.json.JSONArray(withContext(Dispatchers.IO) { captures.stageBatch(productPhotos) }))
                    withContext(Dispatchers.IO) { credentials.savePendingStopCommand(planId, pending!!.toString()) }
                    state = state.copy(pending = true)
                    sendPendingLocked()
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) {
                    if (!state.pending) clearPending() // Persistence failed: nothing was sent.
                    state = state.copy(message = friendlyError(failure))
                }
                finally { state = state.copy(busy = false) }
            }
        }
    }
    fun retry() {
        if (state.busy || pending == null || state.retired) return
        state = state.copy(busy = true)
        viewModelScope.launch {
            gate.withLock {
                try { sendPendingLocked() }
                finally { state = state.copy(busy = false) }
            }
        }
    }
    private suspend fun sendPendingLocked() {
        val command = pending ?: return
        try {
            val saved = access()
            if (saved.token.isBlank() || saved.deviceId != command.getString("deviceId")) {
                retire("La sesión cambió. Vuelve a ingresar."); return
            }
            val payload = command.getJSONObject("payload")
            when (command.getString("kind")) {
                "service" -> api.serviceCommand(saved.token, planId, command.getString("stopId"), command.getString("shipmentId"), payload)
                "product-incident" -> {
                    // Check the durable receipt first, including after an app restart or a lost response.
                    var incidentId = api.confirmedClosedIncident(saved.token, planId, payload.getString("commandId"))
                    if (incidentId == null) {
                        val bytes = withContext(Dispatchers.IO) {
                            command.optJSONArray("evidenceKeys")?.let { keys ->
                                (0 until keys.length()).map { captures.read(keys.getString(it)) }
                            } ?: command.optString("evidenceKey").takeIf(String::isNotBlank)?.let { listOf(captures.read(it)) }.orEmpty()
                        }
                        incidentId = api.productIncidentCommand(saved.token, planId, command.getString("stopId"), command.getString("shipmentId"), payload, bytes).getString("incidentId")
                    }
                    command.put("incidentId", incidentId)
                }
                "product-incident-amend", "product-incident-cancel" -> {
                    val id = command.getString("incidentId")
                    if (api.confirmedClosedIncident(saved.token, planId, payload.getString("commandId")) == null)
                        api.changeProductIncidentCommand(saved.token, planId, command.getString("stopId"),
                            command.getString("shipmentId"), id,
                            if (command.getString("kind") == "product-incident-amend") "amend" else "cancel", payload)
                }
                "order-retry" -> api.retryOrderCommand(saved.token, planId, command.getString("stopId"), command.getString("shipmentId"), payload)
                "closed" -> {
                    var incidentId = api.confirmedClosedIncident(saved.token, planId, payload.getString("commandId"))
                    if (incidentId == null) {
                        val bytes = withContext(Dispatchers.IO) { captures.read(command.getString("evidenceKey")) }
                        val posted = api.closedCommand(saved.token, planId, command.getString("stopId"), payload, bytes)
                        incidentId = api.confirmedClosedIncident(saved.token, planId, payload.getString("commandId"))
                        check(incidentId != null && incidentId == posted.getString("incidentId")) { "Sin confirmación de incidencia" }
                    }
                    command.put("incidentId", incidentId)
                }
                else -> api.stopCommand(saved.token, planId, command.getString("stopId"), command.getString("kind"), payload)
            }
            clearPending()
            confirmed = command
            loadLocked()
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            if (failure is DriverApiException && failure.status in 400..499 && failure.status != 429) {
                clearPending()
                loadLocked()
                if (!state.retired) state = state.copy(message = friendlyError(failure))
            } else state = state.copy(pending = true, verified = false,
                message = "Sin confirmación de red. Reintenta verificar: no se registrará dos veces.")
        }
    }
    companion object {
        fun factory(credentials: DeviceCredentials, planId: String, captures: IncidentCaptureStore) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = RouteExecutionModel(credentials, planId, captures) as T
        }
    }
}
