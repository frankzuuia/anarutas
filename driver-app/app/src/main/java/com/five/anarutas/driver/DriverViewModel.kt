package com.five.anarutas.driver

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import android.content.Context
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.GeneralSecurityException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONException

internal fun isPrivateCameraCapture(cacheDir: File, file: File): Boolean =
    file.parentFile?.canonicalFile == File(cacheDir, "unit-camera").canonicalFile &&
        file.name.startsWith("unit-") && file.name.endsWith(".jpg") &&
        file.isFile && file.length() > 0L

internal fun canDeleteUnitPhoto(route: AssignedPlan?, photos: List<UnitPhoto>, photoId: String): Boolean =
    route != null && route.startedAt == null && photos.any { it.id == photoId }

data class DriverUiState(
    val initializing: Boolean = true,
    val phone: String = "",
    val pin: String = "",
    val deviceId: String = "",
    val token: String = "",
    val busy: Boolean = false,
    val error: String = "",
    val notice: String = "",
    val dashboard: DriverDashboard? = null,
    val selected: AssignedPlan? = null,
    val destination: DriverDestination = DriverDestination.HOME,
    val photos: List<UnitPhoto> = emptyList(),
    val showPhotos: Boolean = false,
    val orderDetailId: String? = null,
)

internal fun reconcilePublishedRoutes(state: DriverUiState, dashboard: DriverDashboard): DriverUiState {
    val previous = state.selected ?: state.dashboard?.today
    val withdrawn = previous != null && dashboard.plans.none { it.id == previous.id }
    val dayChanged = state.dashboard?.serviceDate?.let { it != dashboard.serviceDate } ?: false
    val resetRoute = withdrawn || dayChanged
    val priorRevisions = state.dashboard?.plans?.associate { it.id to it.publicationRevision }.orEmpty()
    val newlyPublished = state.dashboard != null && dashboard.plans.any { plan ->
        val prior = priorRevisions[plan.id]
        prior == null || prior < plan.publicationRevision
    }
    val selected = when {
        resetRoute -> dashboard.today
        previous?.id == dashboard.today?.id -> dashboard.today
        previous != null -> previous
        else -> dashboard.today
    }
    return state.copy(
        dashboard = dashboard,
        selected = selected,
        destination = if (resetRoute) DriverDestination.HOME else state.destination,
        photos = if (resetRoute) emptyList() else state.photos,
        showPhotos = if (resetRoute) false else state.showPhotos,
        orderDetailId = if (resetRoute) null else state.orderDetailId,
        notice = when {
            dayChanged -> "Nuevo día de operación. Toma las fotos de hoy antes de iniciar tu ruta."
            withdrawn -> "Administración retiró esta ruta. Espera una nueva publicación."
            newlyPublished -> "Tienes una ruta nueva o actualizada. Ya aparece en tu jornada."
            else -> state.notice
        },
    )
}

internal fun friendlyError(error: Throwable): String = when (error) {
    is DriverApiException -> when (error.code) {
        "MOBILE_LOGIN_INVALID" -> "Teléfono o PIN incorrectos. Verifica tus datos con administración."
        "MOBILE_UNAUTHENTICATED" -> "La sesión terminó o fue revocada. Entra otra vez."
        "TOO_MANY_ATTEMPTS" -> "Demasiados intentos. Espera antes de volver a probar."
        "MOBILE_ACCESS_DISABLED" -> "El administrador aún no habilita tu acceso."
        "NOT_FOUND" -> "Esta ruta ya no está asignada a tu camioneta. Actualiza la lista."
        "UNIT_PHOTO_STORAGE_UNAVAILABLE" -> "No se pueden guardar fotos todavía. Administración debe configurar el almacenamiento de la unidad."
        "UNIT_PHOTO_LIMIT" -> "Esta ruta ya tiene ocho fotos de la unidad."
        "UNIT_PHOTO_INVALID" -> "La foto de la cámara no se pudo procesar. Vuelve a tomarla."
        "UNIT_PHOTO_TOO_LARGE" -> "La foto es demasiado grande. Vuelve a tomarla con menor resolución."
        "UNIT_PHOTO_REUSED" -> "Esta imagen ya se usó en otra ruta de la unidad. Toma una foto nueva."
        "UNIT_PHOTOS_REQUIRED" -> "Carga al menos cinco fotos distintas de la unidad antes de iniciar."
        "VERSION_CONFLICT" -> "La ruta cambió desde que la abriste. Actualízala y confirma de nuevo."
        "ROUTE_DATE_MISMATCH" -> "Esta ruta no corresponde al día de hoy."
        "ROUTE_ALREADY_STARTED" -> "Esta ruta ya inició y no admite más fotos ni cambios."
        else -> if (error.status == 404 && error.code.isBlank())
            "El servidor aún no tiene disponible esta función. Avisa a administración para actualizarlo."
        else "El servidor rechazó la solicitud (${error.code.ifBlank { error.status.toString() }})."
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
    "empty" -> "Esta camioneta todavía no tiene pedidos asignados."
    else -> "La ruta no está lista. Consulta con administración."
}

internal fun canReenrollAfterChallengeFailure(failure: Throwable): Boolean =
    (failure is DriverApiException && failure.code == "MOBILE_LOGIN_INVALID") ||
        (failure is IllegalStateException && failure.message == "DEVICE_KEY_MISSING")

class DriverViewModel(private val credentials: DeviceCredentials) : ViewModel() {
    var state by mutableStateOf(DriverUiState())
        private set
    private var syncing = false
    private var refreshQueued = false
    private var routeMutationGeneration = 0

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
                    loadDashboard(saved.token)
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
                loadDashboard(session.token)
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
                NavigationRegistry.endSession()
                state = state.copy(
                    deviceId = "",
                    token = "",
                    pin = "",
                    dashboard = null,
                    selected = null,
                    destination = DriverDestination.HOME,
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

    fun refreshDashboard() {
        if (state.busy || state.token.isBlank()) return
        val accessToken = state.token
        state = state.copy(busy = true, error = "", notice = "")
        viewModelScope.launch {
            try {
                loadDashboard(accessToken)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                handleApiFailure(failure)
            } finally {
                state = state.copy(busy = false)
            }
        }
    }

    fun syncDashboard(manual: Boolean = false) {
        if (syncing || state.busy || state.token.isBlank()) return
        syncing = true
        val accessToken = state.token
        val observedGeneration = routeMutationGeneration
        if (manual) state = state.copy(busy = true, error = "", notice = "")
        viewModelScope.launch {
            try {
                val latest = DriverApi(BuildConfig.SERVER_URL).dashboard(accessToken)
                if (state.token == accessToken && observedGeneration == routeMutationGeneration && (!state.busy || manual)) {
                    val withdrawn = (state.selected ?: state.dashboard?.today)?.let { route ->
                        latest.plans.none { it.id == route.id }
                    } == true
                    if (withdrawn) NavigationRegistry.endSession()
                    state = reconcilePublishedRoutes(state, latest)
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                if (manual || (failure is DriverApiException && failure.status == 401))
                    handleApiFailure(failure)
            } finally {
                syncing = false
                if (manual) state = state.copy(busy = false)
            }
        }
    }

    fun requestDashboardRefresh() {
        if (state.token.isBlank() || refreshQueued) return
        val token = state.token
        refreshQueued = true
        viewModelScope.launch {
            while (refreshQueued && state.token == token) {
                if (state.busy || syncing) {
                    delay(150)
                    continue
                }
                refreshQueued = false
                syncDashboard()
            }
            if (state.token != token) refreshQueued = false
        }
    }

    fun selectPlan(planId: String) {
        if (state.busy || state.token.isBlank()) return
        val accessToken = state.token
        state = state.copy(busy = true, error = "", notice = "")
        viewModelScope.launch {
            try {
                state = state.copy(
                    selected = DriverApi(BuildConfig.SERVER_URL).plan(accessToken, planId),
                    destination = DriverDestination.ROUTE,
                )
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                handleApiFailure(failure)
            } finally {
                state = state.copy(busy = false)
            }
        }
    }

    fun navigate(destination: DriverDestination) {
        val selected = when (destination) {
            DriverDestination.HOME -> state.dashboard?.today
            DriverDestination.ROUTE, DriverDestination.ORDERS, DriverDestination.UNIT ->
                state.selected ?: state.dashboard?.today
            DriverDestination.PROFILE, DriverDestination.HISTORY, DriverDestination.SETTINGS -> state.selected
        }
        state = state.copy(
            destination = destination,
            selected = selected,
            error = "",
            notice = "",
            orderDetailId = null,
            showPhotos = false,
        )
    }

    fun showOrder(orderId: String) {
        state = state.copy(orderDetailId = orderId)
    }

    fun closeOrder() {
        state = state.copy(orderDetailId = null)
    }

    fun openPhotos() {
        val route = state.selected ?: state.dashboard?.today ?: return
        if (state.busy) return
        val token = state.token
        state = state.copy(showPhotos = false, photos = emptyList(), busy = true, error = "")
        viewModelScope.launch {
            try {
                val photos = DriverApi(BuildConfig.SERVER_URL).unitPhotos(token, route.id)
                if (state.token == token && (state.selected ?: state.dashboard?.today)?.id == route.id)
                    state = state.copy(photos = photos, showPhotos = true)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                handleApiFailure(failure)
            } finally {
                state = state.copy(busy = false)
            }
        }
    }

    fun closePhotos() {
        state = state.copy(showPhotos = false)
    }

    fun cameraUnavailable() {
        state = state.copy(error = "No se pudo abrir la cámara. Revisa que haya una app de cámara disponible.")
    }

    fun deleteUnitPhoto(photoId: String) {
        val route = state.selected ?: state.dashboard?.today
        if (state.busy || state.token.isBlank() || !canPrepareRoute(route, state.dashboard?.serviceDate) || !canDeleteUnitPhoto(route, state.photos, photoId)) return
        val activeRoute = route ?: return
        val planId = activeRoute.id
        val token = state.token
        routeMutationGeneration++
        state = state.copy(busy = true, error = "", notice = "")
        viewModelScope.launch {
            try {
                val api = DriverApi(BuildConfig.SERVER_URL)
                val photoCount = api.deleteUnitPhoto(token, photoId)
                if (state.token == token && (state.selected ?: state.dashboard?.today)?.id == planId) {
                    val updated = activeRoute.copy(photoCount = photoCount)
                    state = state.copy(
                        selected = updated,
                        dashboard = state.dashboard?.let { dashboard ->
                            if (dashboard.today?.id == planId) dashboard.copy(today = updated) else dashboard
                        },
                        photos = state.photos.filterNot { it.id == photoId },
                        notice = "Foto eliminada · $photoCount de 8",
                    )
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                handleApiFailure(failure)
                if (failure is DriverApiException && failure.code == "ROUTE_ALREADY_STARTED") {
                    runCatching { DriverApi(BuildConfig.SERVER_URL).plan(token, planId) }
                        .getOrNull()?.let { refreshed ->
                            if (state.token == token) state = state.copy(selected = refreshed)
                        }
                }
            } finally {
                state = state.copy(busy = false)
            }
        }
    }

    fun uploadUnitPhoto(context: Context, cameraFile: File) {
        val route = state.selected ?: state.dashboard?.today
        if (!canPrepareRoute(route, state.dashboard?.serviceDate) || state.busy || state.token.isBlank()) {
            cameraFile.delete()
            return
        }
        route ?: return
        val token = state.token
        routeMutationGeneration++
        state = state.copy(busy = true, error = "", notice = "")
        viewModelScope.launch {
            try {
                val bytes = withContext(Dispatchers.IO) {
                    if (!isPrivateCameraCapture(context.cacheDir, cameraFile))
                        throw DriverApiException(415, "UNIT_PHOTO_INVALID")
                    cameraFile.inputStream().use { stream ->
                        val output = ByteArrayOutputStream()
                        val chunk = ByteArray(8192)
                        while (true) {
                            val count = stream.read(chunk)
                            if (count < 0) break
                            if (output.size() + count > 8 * 1024 * 1024)
                                throw DriverApiException(413, "UNIT_PHOTO_TOO_LARGE")
                            output.write(chunk, 0, count)
                        }
                        output.toByteArray().also {
                            if (it.isEmpty()) throw DriverApiException(415, "UNIT_PHOTO_INVALID")
                        }
                    }
                }
                val api = DriverApi(BuildConfig.SERVER_URL)
                val upload = api.uploadUnitPhoto(token, route.id, bytes)
                val refreshed = api.plan(token, route.id)
                state = state.copy(
                    selected = refreshed,
                    dashboard = state.dashboard?.let { dashboard ->
                        if (dashboard.today?.id == refreshed.id) dashboard.copy(today = refreshed) else dashboard
                    },
                    photos = api.unitPhotos(token, route.id),
                    notice = if (upload.duplicate) "Esa foto ya estaba registrada · ${refreshed.photoCount} de 8"
                        else "Foto guardada · ${refreshed.photoCount} de 8",
                )
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                handleApiFailure(failure)
            } finally {
                runCatching {
                    val cachePath = File(context.cacheDir, "unit-camera").canonicalPath + File.separator
                    if (cameraFile.canonicalPath.startsWith(cachePath) && cameraFile.name.startsWith("unit-"))
                        cameraFile.delete()
                }
                state = state.copy(busy = false)
            }
        }
    }

    fun startRoute(planId: String, expectedRevision: Int) {
        val route = state.selected ?: state.dashboard?.today ?: return
        if (state.busy || state.token.isBlank() || route.startedAt != null ||
            route.id != planId || route.publicationRevision != expectedRevision ||
            !canStartRoute(route, state.dashboard?.serviceDate)) return
        val token = state.token
        routeMutationGeneration++
        state = state.copy(busy = true, error = "", notice = "")
        viewModelScope.launch {
            try {
                val api = DriverApi(BuildConfig.SERVER_URL)
                api.startRoute(token, route.id, expectedRevision)
                val refreshed = api.plan(token, route.id)
                state = state.copy(
                    selected = refreshed,
                    dashboard = state.dashboard?.let { dashboard ->
                        if (dashboard.today?.id == refreshed.id) dashboard.copy(today = refreshed) else dashboard
                    },
                    destination = DriverDestination.ROUTE,
                    notice = "Ruta iniciada. Administración ya puede ver tu salida.",
                )
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                handleApiFailure(failure)
            } finally {
                state = state.copy(busy = false)
            }
        }
    }

    fun logout() {
        if (state.busy || state.token.isBlank()) return
        val accessToken = state.token
        state = state.copy(busy = true, error = "", notice = "")
        viewModelScope.launch {
            try {
                DriverApi(BuildConfig.SERVER_URL).logout(accessToken)
                NavigationRegistry.endSession()
                withContext(Dispatchers.IO) { credentials.clearToken() }
                state = state.copy(
                    token = "",
                    dashboard = null,
                    selected = null,
                    destination = DriverDestination.HOME,
                )
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                handleApiFailure(failure)
            } finally {
                state = state.copy(busy = false)
            }
        }
    }

    private suspend fun loadDashboard(accessToken: String) {
        val dashboard = DriverApi(BuildConfig.SERVER_URL).dashboard(accessToken)
        state = state.copy(
            dashboard = dashboard,
            selected = dashboard.today,
            destination = DriverDestination.HOME,
            error = "",
        )
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
            NavigationRegistry.endSession()
            withContext(Dispatchers.IO) { credentials.clearToken() }
            state = state.copy(
                token = "",
                dashboard = null,
                selected = null,
                destination = DriverDestination.HOME,
            )
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
