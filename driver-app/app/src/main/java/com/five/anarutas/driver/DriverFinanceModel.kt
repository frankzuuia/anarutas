package com.five.anarutas.driver

import androidx.compose.runtime.*
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

internal fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
internal fun JSONObject.objectOrNull(key: String) = if (isNull(key)) null else getJSONObject(key)
internal data class FinanceUiState(val routes: List<JSONObject> = emptyList(), val detail: JSONObject? = null,
    val executionId: String? = null, val busy: Boolean = false, val pending: Boolean = false,
    val message: String = "", val page: Int = 0, val hasMore: Boolean = false, val receiptRevision: Int = 0)
internal class DriverFinanceModel(private val credentials: DeviceCredentials) : ViewModel() {
    var state by mutableStateOf(FinanceUiState()); private set
    private val api = DriverApi(BuildConfig.SERVER_URL)
    private val gate = Mutex()
    private var observer: Job? = null
    private var visibilityRevision = 0
    private var ownerDevice: String? = null
    private suspend fun access() = withContext(Dispatchers.IO) { credentials.load() }.also {
        if (it.token.isBlank()) throw DriverApiException(401, "MOBILE_UNAUTHENTICATED")
        if (ownerDevice != null && ownerDevice != it.deviceId) state = FinanceUiState()
        ownerDevice = it.deviceId
    }
    fun observe() {
        if (observer?.isActive == true) return
        observer = viewModelScope.launch {
            recover()
            while (isActive) {
                try { val saved = access(); api.observeEvents(saved.token) { event ->
                    if (event == "session-expired") throw DriverApiException(401, "MOBILE_UNAUTHENTICATED")
                    if (event == "reset" || event == "change" || event == "heartbeat") refresh()
                } } catch (cancelled: CancellationException) { throw cancelled }
                catch (error: Exception) { state = state.copy(message = friendlyError(error)) }
                delay(5000)
            }
        }
    }
    fun stopObserving() {
        observer?.cancel(); observer = null; visibilityRevision++
        state = state.copy(routes = emptyList(), detail = null, message = "")
    }
    private suspend fun loadLocked() {
        val saved = access()
        val visibleAt = visibilityRevision
        val target = FinanceReadTarget(state.executionId, state.page)
        val routes = api.financeList(saved.token, target.page).objects()
        val detail = target.executionId?.let { api.financeDetail(saved.token, it) }
        val currentAccess = access()
        if (observer?.isActive != true || visibleAt != visibilityRevision || !financeReadStillCurrent(target, FinanceReadTarget(state.executionId, state.page), saved.deviceId, currentAccess.deviceId)) return
        state = state.copy(routes = routes, hasMore = routes.size == 50, detail = detail)
    }
    fun refresh() { viewModelScope.launch { gate.withLock {
        try { loadLocked() } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) { state = state.copy(message = friendlyError(error)) }
    } } }
    fun select(executionId: String?) { state = state.copy(executionId = executionId, detail = null, message = ""); refresh() }
    fun page(delta: Int) { state = state.copy(page = (state.page + delta).coerceAtLeast(0)); refresh() }
    fun submit(executionId: String, kind: String, payload: JSONObject) {
        if (state.busy || state.pending) return
        state = state.copy(busy = true, message = "")
        viewModelScope.launch { gate.withLock {
            try {
                val saved = access()
                val command = JSONObject().put("executionId", executionId).put("kind", kind)
                    .put("payload", payload.put("commandId", UUID.randomUUID().toString())).toString()
                withContext(Dispatchers.IO) { credentials.saveFinanceCommand(saved.deviceId, command) }
                state = state.copy(pending = true)
                sendLocked(saved, command)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { state = state.copy(message = friendlyError(error)); recoverPendingFlag() }
            finally { state = state.copy(busy = false) }
        } }
    }
    private suspend fun recoverPendingFlag() {
        try { val saved = access(); state = state.copy(pending = withContext(Dispatchers.IO) { credentials.readFinanceCommand(saved.deviceId) != null }) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { state = state.copy(pending = true) }
    }
    private suspend fun sendLocked(saved: SavedAccess, command: String) {
        val value = JSONObject(command)
        try {
            api.financeCommand(saved.token, value.getString("executionId"), value.getString("kind"), value.getJSONObject("payload"))
            withContext(Dispatchers.IO) { credentials.clearFinanceCommand(saved.deviceId, command) }
            state = state.copy(pending = false, message = "Confirmado y guardado.", receiptRevision = state.receiptRevision + 1)
            loadLocked()
        } catch (error: DriverApiException) {
            if (!financeCommandRetryable(error.status)) {
                withContext(Dispatchers.IO) { credentials.clearFinanceCommand(saved.deviceId, command) }
                state = state.copy(pending = false)
                try { loadLocked() } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { /* Original rejection remains visible. */ }
            }
            throw error
        }
    }
    fun recover() { viewModelScope.launch { gate.withLock {
        state = state.copy(busy = true)
        try {
            val saved = access()
            val pending = withContext(Dispatchers.IO) { credentials.readFinanceCommand(saved.deviceId) }
            state = state.copy(pending = pending != null)
            if (pending != null) sendLocked(saved, pending) else loadLocked()
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) { state = state.copy(message = friendlyError(error)) }
        finally { state = state.copy(busy = false) }
    } } }
    companion object { fun factory(credentials: DeviceCredentials) = object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST") override fun <T : ViewModel> create(modelClass: Class<T>): T = DriverFinanceModel(credentials) as T
    } }
}
