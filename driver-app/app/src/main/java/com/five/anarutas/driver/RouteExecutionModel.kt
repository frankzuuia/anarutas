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

internal data class ExecutionUiState(val route: AssignedPlan? = null, val execution: DriverExecution? = null,
    val loading: Boolean = true, val busy: Boolean = false, val verified: Boolean = false, val retired: Boolean = false,
    val pending: Boolean = false, val message: String = "Cargando tu ruta…", val arrivedStop: String? = null,
    val correctedStop: String? = null)

/** Owns network/retry state across rotation. Business facts only come from the server. */
internal class RouteExecutionModel(private val credentials: DeviceCredentials, private val planId: String) : ViewModel() {
    var state by mutableStateOf(ExecutionUiState())
        private set
    private val api = DriverApi(BuildConfig.SERVER_URL)
    private val gate = Mutex()
    private var pending: JSONObject? = null
    private var confirmed: JSONObject? = null
    private var recovered = false

    private suspend fun access() = withContext(Dispatchers.IO) { credentials.load() }
    private suspend fun clearPending() {
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
                state = state.copy(
                    message = if (command.getString("kind") == "arrival") "Llegada registrada. Puedes revisar el pedido." else "Punto corregido en tu ruta y en la ficha del cliente.",
                    arrivedStop = command.getString("stopId").takeIf { command.getString("kind") == "arrival" },
                    correctedStop = command.getString("stopId").takeIf { command.getString("kind") == "location" },
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

    fun submit(stopId: String, gps: DriverGps?, corrected: ExecutionPoint?, confirmedAddress: CorrectedAddressFields? = null) {
        val execution = state.execution ?: return
        val stop = execution.stops.find { it.id == stopId } ?: return
        if (state.busy || state.pending || !state.verified || state.retired) return
        val elapsed = SystemClock.elapsedRealtime()
        if (arrivalEligibility(gps, corrected ?: stop.point, execution.policy, elapsed) != ArrivalEligibility.READY) return
        if (corrected != null && stop.customerArchived) return
        val payload = stopCommand(execution, stop, gps!!, elapsed, UUID.randomUUID().toString(), corrected, confirmedAddress)
        state = state.copy(busy = true, message = "Confirmando con el servidor…")
        viewModelScope.launch {
            gate.withLock {
                try {
                    val saved = access()
                    pending = JSONObject().put("deviceId", saved.deviceId).put("planId", planId)
                        .put("stopId", stopId).put("kind", if (corrected == null) "arrival" else "location").put("payload", payload)
                    withContext(Dispatchers.IO) { credentials.savePendingStopCommand(planId, pending!!.toString()) }
                    state = state.copy(pending = true)
                    sendPendingLocked()
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) {
                    if (!state.pending) pending = null // Persistence failed: nothing was sent.
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
            api.stopCommand(saved.token, planId, command.getString("stopId"), command.getString("kind"), command.getJSONObject("payload"))
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
        fun factory(credentials: DeviceCredentials, planId: String) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = RouteExecutionModel(credentials, planId) as T
        }
    }
}
