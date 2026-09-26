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
    val correctedStop: String? = null, val exitDestination: String? = null, val serviceRevision: Int = 0)

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
                        "visit-exit" -> "Parada anterior abierta. Puedes ir al siguiente pedido."
                        "service" -> when (command.getJSONObject("payload").getString("kind")) {
                            "deliver" -> "Entrega registrada. La ruta continúa pendiente de liquidación."
                            "reschedule" -> "Pedido reprogramado. Administración verá tus notas sin una fecha impuesta."
                            else -> "Rechazo registrado. Aún podrás entregarlo si el cliente cambia de opinión."
                        }
                        "closed" -> "Cliente cerrado registrado con evidencia. Pedidos pendientes de reintento."
                        "phone" -> "Teléfono operativo guardado también en la ficha del cliente."
                        else -> "Punto corregido en tu ruta y en la ficha del cliente."
                    },
                    arrivedStop = command.getString("stopId").takeIf { kind == "arrival" },
                    correctedStop = command.getString("stopId").takeIf { kind == "location" },
                    exitDestination = command.optString("destinationStopId").takeIf { kind == "visit-exit" && it.isNotBlank() },
                    serviceRevision = state.serviceRevision + if (kind == "service" || kind == "closed") 1 else 0,
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
        queueCommand(stopId, "service", payload, shipmentId = shipmentId)
    }
    fun reportClosed(stopId: String, note: String, photo: File) {
        val execution = state.execution ?: return
        val stop = execution.stops.find { it.id == stopId } ?: return
        if (!serviceAvailable(stop) || !stop.canAttend() || note.length > 2000) return
        queueCommand(stopId, "closed", visitExitCommand(execution, stop, UUID.randomUUID().toString()).put("note", note), capture = photo)
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
        shipmentId: String? = null, capture: File? = null) {
        state = state.copy(busy = true, message = "Confirmando con el servidor…")
        viewModelScope.launch {
            gate.withLock {
                try {
                    val saved = access()
                    pending = JSONObject().put("deviceId", saved.deviceId).put("planId", planId)
                        .put("stopId", stopId).put("kind", kind).put("payload", payload)
                    if (destinationStopId != null) pending!!.put("destinationStopId", destinationStopId)
                    if (shipmentId != null) pending!!.put("shipmentId", shipmentId)
                    if (capture != null) pending!!.put("evidenceKey", withContext(Dispatchers.IO) { captures.stage(capture) })
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
                "closed" -> {
                    if (!api.commandConfirmed(saved.token, planId, payload.getString("commandId"))) {
                        val bytes = withContext(Dispatchers.IO) { captures.read(command.getString("evidenceKey")) }
                        api.closedCommand(saved.token, planId, command.getString("stopId"), payload, bytes)
                    }
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
