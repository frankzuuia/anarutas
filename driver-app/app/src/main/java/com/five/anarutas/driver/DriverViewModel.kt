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
    val phone: String = "",
    val pin: String = "",
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
        "MOBILE_LOGIN_INVALID" -> "Teléfono o PIN incorrectos. Verifica tus datos con administración."
        "MOBILE_UNAUTHENTICATED" -> "La sesión terminó o fue revocada. Entra otra vez."
        "TOO_MANY_ATTEMPTS" -> "Demasiados intentos. Espera antes de volver a probar."
        "MOBILE_ACCESS_DISABLED" -> "El administrador aún no habilita tu acceso."
        "NOT_FOUND" -> "Esta ruta ya no está asignada a tu camioneta. Actualiza la lista."
        else -> "El servidor rechazó la solicitud (${error.code.ifBlank { error.status.toString() }})."
    }
    is IllegalStateException -> if (error.message == "DEVICE_KEY_MISSING") {
        "La clave segura de este celular ya no está disponible. Vuelve a ingresar con teléfono y PIN."
    } else {
        "No se pudo abrir el acceso seguro del celular."
    }
    is GeneralSecurityException ->
        "No se pudo abrir el acceso seguro del celular. Vuelve a ingresar con teléfono y PIN."
    is JSONException ->
        "La respuesta del servidor no tiene el formato esperado. Avisa a administración."
    else -> "No se pudo conectar. Revisa tu conexión a internet."
}

internal fun routeStatusMessage(status: String): String? = when (status) {
    "current" -> null
    "stale" -> "El recorrido cambió; espera que administración lo actualice."
    "not_calculated" -> "Administración todavía no ha calculado el recorrido."
    else -> "La ruta no está lista. Consulta con administración."
}

internal fun canReenrollAfterChallengeFailure(failure: Throwable): Boolean =
    (failure is DriverApiException && failure.code == "MOBILE_LOGIN_INVALID") ||
        (failure is IllegalStateException && failure.message == "DEVICE_KEY_MISSING")

class DriverViewModel(private val credentials: DeviceCredentials) : ViewModel() {
    var state by mutableStateOf(DriverUiState())
        private set

    init {
        viewModelScope.launch {
            try {
                val saved = withContext(Dispatchers.IO) { credentials.load() }
                state = state.copy(
                    initializing = false,
                    phone = saved.phone,
                    deviceId = saved.deviceId,
                    token = saved.token,
                )
                if (saved.token.isNotBlank()) {
                    state = state.copy(busy = true)
                    loadPlans(saved.token)
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

    fun updatePhone(value: String) {
        state = state.copy(phone = value, error = "", notice = "")
    }

    fun updatePin(value: String) {
        if (value.length <= 4) state = state.copy(pin = value, error = "")
    }

    fun submitAccess() {
        if (state.busy || state.initializing) return
        val normalizedPhone = ClientValidation.phone(state.phone)
        val validationError = when {
            normalizedPhone == null -> "Escribe un teléfono mexicano válido de 10 dígitos."
            !ClientValidation.pin(state.pin) -> "El PIN debe tener exactamente 4 dígitos."
            else -> ""
        }
        if (validationError.isNotBlank()) {
            state = state.copy(error = validationError, notice = "")
            return
        }
        val validPhone = normalizedPhone ?: return
        val enteredPin = state.pin
        val priorDeviceId = state.deviceId
        state = state.copy(busy = true, error = "", notice = "")
        viewModelScope.launch {
            try {
                val api = DriverApi(BuildConfig.SERVER_URL)
                val session = if (priorDeviceId.isBlank()) {
                    enrollNewDevice(api, validPhone, enteredPin)
                } else {
                    val challenge = try {
                        api.challenge(validPhone, priorDeviceId)
                    } catch (failure: DriverApiException) {
                        if (!canReenrollAfterChallengeFailure(failure)) throw failure
                        null
                    }
                    if (challenge == null) {
                        enrollNewDevice(api, validPhone, enteredPin, resetKey = true)
                    } else {
                        val signature = try {
                            withContext(Dispatchers.IO) {
                                credentials.signChallenge(challenge.id, challenge.nonce)
                            }
                        } catch (failure: IllegalStateException) {
                            if (!canReenrollAfterChallengeFailure(failure)) throw failure
                            null
                        }
                        if (signature == null) enrollNewDevice(api, validPhone, enteredPin, resetKey = true)
                        else api.login(validPhone, enteredPin, priorDeviceId, challenge, signature)
                    }
                }
                withContext(Dispatchers.IO) {
                    credentials.save(validPhone, session.deviceId, session.token)
                }
                state = state.copy(
                    phone = validPhone,
                    deviceId = session.deviceId,
                    token = session.token,
                    pin = "",
                )
                loadPlans(session.token)
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
                    plans = emptyList(),
                    selected = null,
                    notice = "Ingresa tu teléfono y PIN para registrar nuevamente este celular.",
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
        if (state.busy || state.token.isBlank()) return
        val accessToken = state.token
        state = state.copy(busy = true, error = "", notice = "")
        viewModelScope.launch {
            try {
                loadPlans(accessToken)
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
        if (state.busy || state.token.isBlank()) return
        val accessToken = state.token
        state = state.copy(busy = true, error = "", notice = "")
        viewModelScope.launch {
            try {
                state = state.copy(selected = DriverApi(BuildConfig.SERVER_URL).plan(accessToken, planId))
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
        if (state.busy || state.token.isBlank()) return
        val accessToken = state.token
        state = state.copy(busy = true, error = "", notice = "")
        viewModelScope.launch {
            try {
                DriverApi(BuildConfig.SERVER_URL).logout(accessToken)
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

    private suspend fun loadPlans(accessToken: String) {
        state = state.copy(plans = DriverApi(BuildConfig.SERVER_URL).plans(accessToken), error = "")
    }

    private suspend fun enrollNewDevice(
        api: DriverApi,
        phone: String,
        pin: String,
        resetKey: Boolean = false,
    ): DriverSession {
        val publicKey = withContext(Dispatchers.IO) {
            if (resetKey) credentials.clearDevice()
            credentials.publicKeyPem()
        }
        state = state.copy(deviceId = "")
        return api.enroll(phone, pin, publicKey)
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
