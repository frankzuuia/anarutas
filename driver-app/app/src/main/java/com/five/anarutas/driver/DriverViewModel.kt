package com.five.anarutas.driver

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import java.security.GeneralSecurityException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONException

data class DriverUiState(
    val initializing: Boolean = true,
    val server: String = "",
    val phone: String = "",
    val pin: String = "",
    val code: String = "",
    val deviceId: String = "",
    val token: String = "",
    val busy: Boolean = false,
    val error: String = "",
    val notice: String = "",
    val plans: List<PlanSummary> = emptyList(),
    val selected: AssignedPlan? = null,
)

internal fun friendlyError(error: Throwable): String = when (error) {
    is DriverApiException -> when (error.code) {
        "MOBILE_LOGIN_INVALID" -> "Datos incorrectos o celular no autorizado. Revisa el PIN y la activación."
        "MOBILE_UNAUTHENTICATED" -> "La sesión terminó o fue revocada. Entra otra vez."
        "TOO_MANY_ATTEMPTS" -> "Demasiados intentos. Espera antes de volver a probar."
        "MOBILE_ACCESS_DISABLED" -> "El administrador aún no habilita tu acceso."
        "NOT_FOUND" -> "Esta ruta ya no está asignada a tu camioneta. Actualiza la lista."
        else -> "El servidor rechazó la solicitud (${error.code.ifBlank { error.status.toString() }})."
    }
    is IllegalStateException -> if (error.message == "DEVICE_KEY_MISSING") {
        "La clave de este celular ya no está disponible. Solicita una nueva activación."
    } else {
        "No se pudo abrir el acceso seguro del celular."
    }
    is GeneralSecurityException ->
        "No se pudo abrir el acceso seguro del celular. Solicita una nueva activación."
    is JSONException ->
        "La respuesta del servidor no tiene el formato esperado. Avisa a administración."
    else -> "No se pudo conectar. Revisa tu internet y la dirección HTTPS del servidor."
}

internal fun routeStatusMessage(status: String): String? = when (status) {
    "current" -> null
    "stale" -> "El recorrido cambió; espera que administración lo actualice."
    "not_calculated" -> "Administración todavía no ha calculado el recorrido."
    else -> "La ruta no está lista. Consulta con administración."
}

class DriverViewModel(private val credentials: DeviceCredentials) : ViewModel() {
    var state by mutableStateOf(DriverUiState())
        private set

    init {
        viewModelScope.launch {
            try {
                val saved = withContext(Dispatchers.IO) { credentials.load() }
                state = state.copy(
                    initializing = false,
                    server = saved.server,
                    phone = saved.phone,
                    deviceId = saved.deviceId,
                    token = saved.token,
                )
                if (saved.token.isNotBlank() && saved.server.isNotBlank()) {
                    state = state.copy(busy = true)
                    loadPlans(saved.token, saved.server)
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                handleApiFailure(failure)
            } finally {
                state = state.copy(initializing = false, busy = false)
            }
        }
    }

    fun updateServer(value: String) {
        state = state.copy(server = value, error = "", notice = "")
    }

    fun updatePhone(value: String) {
        state = state.copy(phone = value, error = "", notice = "")
    }

    fun updatePin(value: String) {
        if (value.length <= 4) state = state.copy(pin = value, error = "")
    }

    fun updateCode(value: String) {
        if (value.length <= 64) state = state.copy(code = value.lowercase(), error = "")
    }

    fun submitAccess() {
        if (state.busy || state.initializing) return
        val normalizedServer = ClientValidation.serverOrigin(state.server)
        val normalizedPhone = ClientValidation.phone(state.phone)
        val validationError = when {
            normalizedServer == null -> "Escribe la dirección HTTPS del servidor, sin ruta adicional."
            normalizedPhone == null -> "Escribe un teléfono válido de 10 a 15 dígitos."
            !ClientValidation.pin(state.pin) -> "El PIN debe tener exactamente 4 dígitos."
            state.deviceId.isBlank() && !ClientValidation.activationCode(state.code) ->
                "Pega el código de activación completo."
            else -> ""
        }
        if (validationError.isNotBlank()) {
            state = state.copy(error = validationError, notice = "")
            return
        }
        val validServer = normalizedServer ?: return
        val validPhone = normalizedPhone ?: return
        val enteredPin = state.pin
        val enteredCode = state.code
        val priorDeviceId = state.deviceId
        state = state.copy(busy = true, error = "", notice = "")
        viewModelScope.launch {
            try {
                val api = DriverApi(validServer)
                val session = if (priorDeviceId.isBlank()) {
                    val publicKey = withContext(Dispatchers.IO) {
                        credentials.generateNewPublicKeyPem()
                    }
                    api.enroll(validPhone, enteredPin, enteredCode, publicKey)
                } else {
                    val challenge = api.challenge(validPhone, priorDeviceId)
                    val signature = withContext(Dispatchers.IO) {
                        credentials.signChallenge(challenge.id, challenge.nonce)
                    }
                    api.login(validPhone, enteredPin, priorDeviceId, challenge, signature)
                }
                withContext(Dispatchers.IO) {
                    credentials.save(validServer, validPhone, session.deviceId, session.token)
                }
                state = state.copy(
                    server = validServer,
                    phone = validPhone,
                    deviceId = session.deviceId,
                    token = session.token,
                    pin = "",
                    code = "",
                )
                loadPlans(session.token, validServer)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                handleApiFailure(failure)
            } finally {
                state = state.copy(busy = false)
            }
        }
    }

    fun reactivateDevice() {
        if (state.busy || state.deviceId.isBlank()) return
        state = state.copy(busy = true, error = "", notice = "")
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) { credentials.clearDevice() }
                state = state.copy(
                    deviceId = "",
                    token = "",
                    pin = "",
                    code = "",
                    plans = emptyList(),
                    selected = null,
                    notice = "Solicita un nuevo código a administración para autorizar este celular.",
                )
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                state = state.copy(error = friendlyError(failure))
            } finally {
                state = state.copy(busy = false)
            }
        }
    }

    fun refreshPlans() {
        if (state.busy || state.token.isBlank() || state.server.isBlank()) return
        val accessToken = state.token
        val origin = state.server
        state = state.copy(busy = true, error = "", notice = "")
        viewModelScope.launch {
            try {
                loadPlans(accessToken, origin)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                handleApiFailure(failure)
            } finally {
                state = state.copy(busy = false)
            }
        }
    }

    fun selectPlan(planId: String) {
        if (state.busy || state.token.isBlank() || state.server.isBlank()) return
        val accessToken = state.token
        val origin = state.server
        state = state.copy(busy = true, error = "", notice = "")
        viewModelScope.launch {
            try {
                state = state.copy(selected = DriverApi(origin).plan(accessToken, planId))
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                handleApiFailure(failure)
            } finally {
                state = state.copy(busy = false)
            }
        }
    }

    fun backToPlans() {
        state = state.copy(selected = null, error = "", notice = "")
    }

    fun logout() {
        if (state.busy || state.token.isBlank() || state.server.isBlank()) return
        val accessToken = state.token
        val origin = state.server
        state = state.copy(busy = true, error = "", notice = "")
        viewModelScope.launch {
            try {
                DriverApi(origin).logout(accessToken)
                withContext(Dispatchers.IO) { credentials.clearToken() }
                state = state.copy(token = "", plans = emptyList(), selected = null)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                handleApiFailure(failure)
            } finally {
                state = state.copy(busy = false)
            }
        }
    }

    private suspend fun loadPlans(accessToken: String, origin: String) {
        state = state.copy(plans = DriverApi(origin).plans(accessToken), error = "")
    }

    private suspend fun handleApiFailure(failure: Exception) {
        if (failure is DriverApiException && failure.status == 401) {
            withContext(Dispatchers.IO) { credentials.clearToken() }
            state = state.copy(token = "", plans = emptyList(), selected = null)
        }
        state = state.copy(error = friendlyError(failure))
    }

    companion object {
        fun factory(credentials: DeviceCredentials): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    require(modelClass.isAssignableFrom(DriverViewModel::class.java))
                    return DriverViewModel(credentials) as T
                }
            }
    }
}
