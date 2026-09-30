package com.five.anarutas.driver

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.IBinder
import android.os.Build
import android.os.Looper
import android.os.SystemClock
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.core.location.LocationCompat
import kotlinx.coroutines.*
import org.json.JSONObject
import java.util.UUID

/** Latest-only telemetry. Never supplies GPS to ArrivalGate or queues a trail. */
class LiveTrackingService : Service() {
    companion object {
        private const val CHANNEL = "live-route-tracking"
        private const val NOTIFICATION = 2107
        private var requested: String? = null
        private var paused: String? = null
        private var instance: LiveTrackingService? = null
        internal var message by mutableStateOf("Seguimiento del centro de control pendiente")
            private set
        internal fun ensure(context: Context, execution: DriverExecution, target: TrackingDestination, resume: Boolean = false) {
            if (execution.completedAt != null) { stop(); return }
            if (resume) paused = null
            if (paused == execution.id) return
            if (instance?.executionId == execution.id) { instance?.updateDestination(target); return }
            if (requested == execution.id) return
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                message = "Seguimiento: falta permiso de ubicación precisa"; return
            }
            requested = execution.id
            try {
                ContextCompat.startForegroundService(context, Intent(context, LiveTrackingService::class.java)
                    .putExtra("plan", execution.planId).putExtra("execution", execution.id)
                    .putExtra("publication", execution.publicationRevision).putExtra("target", target.stopId)
                    .putExtra("depotVersion", target.depotVersion ?: 0))
            } catch (_: RuntimeException) { requested = null; paused = execution.id; message = "No se pudo iniciar seguimiento. Toca Reanudar seguimiento." }
        }
        internal fun stop() { instance?.stopTracking() }
        internal fun destination(execution: String?, target: TrackingDestination) {
            if (execution != null && instance?.executionId == execution) instance?.updateDestination(target)
        }
        internal fun isPaused(id: String) = paused == id
    }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val api = DriverApi(BuildConfig.SERVER_URL)
    private lateinit var locations: LocationManager
    private var job: Job? = null
    private var executionId: String? = null
    private var trackingDestination = TrackingDestination()
    private var rejectedDepotVersion: Int? = null
    private fun updateDestination(target: TrackingDestination) {
        if (target.depotVersion != rejectedDepotVersion) rejectedDepotVersion = null
        trackingDestination = target
    }
    private var gps: DriverGps? = null
    private val listener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            val next = DriverGps(ExecutionPoint(location.latitude, location.longitude),
                if (location.hasAccuracy()) location.accuracy.toDouble() else Double.NaN,
                location.elapsedRealtimeNanos / 1_000_000, LocationCompat.isMock(location))
            if (isNewLocationSample(gps, next)) gps = next
        }
        override fun onProviderDisabled(provider: String) { gps = null }
        @Deprecated("Legacy Android callback") override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) = Unit
    }
    override fun onCreate() {
        super.onCreate(); instance = this
        locations = getSystemService(LocationManager::class.java)
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "Ruta compartida con administración", NotificationManager.IMPORTANCE_LOW))
    }
    override fun onBind(intent: Intent?): IBinder? = null
    @SuppressLint("MissingPermission")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "stop") { stopTracking(); return START_NOT_STICKY }
        val plan = intent?.getStringExtra("plan")
        val execution = intent?.getStringExtra("execution")
        val publication = intent?.getIntExtra("publication", 0) ?: 0
        if (plan.isNullOrBlank() || execution.isNullOrBlank() || publication < 1) { stopSelf(); return START_NOT_STICKY }
        trackingDestination = trackingIntentDestination(intent.getStringExtra("target"), intent.getIntExtra("depotVersion", 0))
        if (executionId == execution) return START_NOT_STICKY
        job?.cancel(); locations.removeUpdates(listener); gps = null
        rejectedDepotVersion = null
        executionId = execution
        val open = PendingIntent.getActivity(this, NOTIFICATION, Intent(this, RouteNavigationActivity::class.java)
            .putExtra(RouteNavigationActivity.EXTRA_PLAN_ID, plan), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, NOTIFICATION, Intent(this, LiveTrackingService::class.java).setAction("stop"),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Five · Ruta en vivo").setContentText("Compartiendo ubicación con tu centro de control")
            .setOngoing(true).setContentIntent(open).addAction(0, "Detener seguimiento", stop).build()
        try {
            val foregroundType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0
            ServiceCompat.startForeground(this, NOTIFICATION, notification, foregroundType)
            for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
                if (locations.allProviders.contains(provider)) locations.requestLocationUpdates(provider, 2000L, 0f, listener, Looper.getMainLooper())
            }
        } catch (_: RuntimeException) { stopTracking(); return START_NOT_STICKY }
        job = scope.launch {
            val session = UUID.randomUUID().toString()
            var began = false; var sequence = 0L; var interval = 5000L; var maxAge = 120000L
            val credentials = DeviceCredentials(applicationContext)
            val access = credentials.load()
            fun payload(kind: String) = JSONObject().put("kind", kind).put("executionId", execution)
                .put("publicationRevision", publication).put("sessionId", session)
            try {
                while (isActive) {
                    if (access.token.isBlank() || credentials.load().token != access.token) { stopTracking(); break }
                    var submittedDestination = TrackingDestination()
                    try {
                        if (!began) {
                            val policy = api.tracking(access.token, plan, payload("begin"))
                            interval = policy.getLong("uploadSeconds") * 1000; maxAge = policy.getLong("maxSampleAgeMs")
                            check(interval > 0 && maxAge > 0); began = true
                        }
                        val now = SystemClock.elapsedRealtime()
                        val fix = trackingGps(gps, now, maxAge)
                        val sample = fix?.let { JSONObject().put("latitude", it.point.latitude).put("longitude", it.point.longitude)
                            .put("accuracyMeters", it.accuracy).put("ageMilliseconds", now - it.elapsedMillis).put("mock", false) }
                        // Read SDK now, on the main thread; never replay a cached ETA after reconnecting.
                        val candidate = trackingEffectiveDestination(trackingDestination, rejectedDepotVersion)
                        val estimate = NavigationRegistry.estimate(execution, candidate.etaId)
                        val target = trackingObservedDestination(candidate, estimate, NavigationRegistry.isGuidanceRunning)
                        submittedDestination = target
                        val destination = target.depotVersion?.let { JSONObject().put("kind", "warehouse").put("depotVersion", it) }
                        val eta = estimate?.takeIf { it.targetStopId == target.etaId }?.let {
                            JSONObject().put("targetStopId", target.stopId ?: JSONObject.NULL).put("state", it.state)
                                .put("remainingSeconds", it.remainingSeconds ?: JSONObject.NULL).put("ageMilliseconds", 0)
                                .apply { target.depotVersion?.let { version -> put("depotVersion", version) } }
                        }
                        api.tracking(access.token, plan, payload("sample").put("sequence", ++sequence)
                            .put("targetStopId", target.stopId ?: JSONObject.NULL).put("sample", sample ?: JSONObject.NULL)
                            .put("destination", destination ?: JSONObject.NULL)
                            .put("eta", eta ?: JSONObject.NULL))
                        message = if (fix == null) "Centro de control conectado · esperando GPS" else "Ubicación compartida con centro de control"
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (error: DriverApiException) {
                        if (submittedDestination.depotVersion != null && trackingRejectsWarehouse(error.status, error.code)) {
                            if (trackingDestination.depotVersion == submittedDestination.depotVersion) rejectedDepotVersion = submittedDestination.depotVersion
                            message = "Regreso desactualizado · revisa tus pedidos y la bodega"
                        } else if (trackingMustStop(error.status)) { stopTracking(); break }
                        else message = "Seguimiento reconectando · última ubicación conservada"
                    } catch (_: Exception) { message = "Seguimiento reconectando · revisa tu conexión" }
                    delay(interval)
                }
            } finally {
                // Best effort only; the server also ages out GPS when the OS kills the process.
                if (began) withContext(NonCancellable) { withTimeoutOrNull(16000) {
                    runCatching { api.tracking(access.token, plan, payload("stop").put("sequence", ++sequence)) }
                } }
            }
        }
        return START_NOT_STICKY
    }
    private fun stopTracking() {
        paused = executionId; requested = null; message = "Seguimiento detenido"
        job?.cancel(); locations.removeUpdates(listener); gps = null
        stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
    }
    override fun onDestroy() {
        job?.cancel(); scope.cancel(); locations.removeUpdates(listener)
        if (instance === this) { instance = null; requested = null }
        super.onDestroy()
    }
}
