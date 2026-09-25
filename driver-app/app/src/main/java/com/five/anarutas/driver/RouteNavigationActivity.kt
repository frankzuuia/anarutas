package com.five.anarutas.driver

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.location.LocationCompat
import androidx.fragment.app.FragmentActivity
import androidx.fragment.app.commitNow
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.google.android.libraries.navigation.NavigationApi
import com.google.android.libraries.navigation.Navigator
import com.google.android.libraries.navigation.RoutingOptions
import com.google.android.libraries.navigation.SupportNavigationFragment
import com.google.android.libraries.navigation.Waypoint
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.GoogleMap
import com.google.android.gms.maps.model.*
import kotlinx.coroutines.*

/** Map rendering never requests routes. Guidance requests just the explicitly selected destination. */
class RouteNavigationActivity : FragmentActivity() {
    private lateinit var model: RouteExecutionModel
    private val locations by lazy { getSystemService(LOCATION_SERVICE) as LocationManager }
    private var gps by mutableStateOf<DriverGps?>(null)
    private var tick by mutableLongStateOf(0L)
    private var selectedId by mutableStateOf("")
    private var editing by mutableStateOf(false)
    private var draftPoint by mutableStateOf<ExecutionPoint?>(null)
    private var showStops by mutableStateOf(false)
    private var showOrder by mutableStateOf(false)
    private var guidance by mutableStateOf(false)
    private var navigating by mutableStateOf(false)
    private var navMessage by mutableStateOf("")
    private var noticeRequired by mutableStateOf(true)
    private var navigator: Navigator? = null
    private var connecting = false
    private var map: GoogleMap? = null
    private var chromeHeight = 0
    private var resumeGuide = false
    private var editRevision: Int? = null
    private var editCustomerVersion: Int? = null
    private var hasFitted = false
    private var requestGeneration = 0
    private val markers = mutableListOf<Marker>()
    private val lines = mutableListOf<Polyline>()
    private var radius: Circle? = null
    private var editorMarker: Marker? = null
    private val currentStop: ExecutionStop? get() = model.state.execution?.stops?.find { it.id == selectedId }

    private val locationListener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            val next = DriverGps(ExecutionPoint(location.latitude, location.longitude),
                if (location.hasAccuracy()) location.accuracy.toDouble() else Double.NaN,
                location.elapsedRealtimeNanos / 1_000_000, LocationCompat.isMock(location))
            val previous = gps
            if (previous == null || next.elapsedMillis - previous.elapsedMillis > 5000 || next.accuracy <= previous.accuracy) gps = next
        }
        override fun onProviderDisabled(provider: String) { gps = null }
        override fun onProviderEnabled(provider: String) = Unit
        @Deprecated("Legacy Android callback") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
    }
    private val permission = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        startGps()
        connectNavigator()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        noticeRequired = DriverPreferences(applicationContext).needsNavigationNotice
        val planId = intent.getStringExtra(EXTRA_PLAN_ID)
        if (planId.isNullOrBlank()) { finish(); return }
        model = ViewModelProvider(this, RouteExecutionModel.factory(DeviceCredentials(applicationContext), planId))[RouteExecutionModel::class.java]
        selectedId = savedInstanceState?.getString("selected_stop").orEmpty()
        val containerId = savedInstanceState?.getInt("map_container") ?: View.generateViewId()
        val root = FrameLayout(this).apply { setBackgroundColor(android.graphics.Color.rgb(13, 15, 18)) }
        root.addView(FrameLayout(this).apply { id = containerId }, FrameLayout.LayoutParams(-1, -1))
        val chrome = ComposeView(this).apply { setContent { DriverTheme { Chrome() } } }
        chrome.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
            chromeHeight = chrome.height
            map?.setPadding(0, 0, 0, chromeHeight)
        }
        root.addView(chrome, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
        setContentView(root)
        root.tag = containerId
        if (BuildConfig.NAVIGATION_API_KEY.isNotBlank()) {
            val fragment = supportFragmentManager.findFragmentByTag("execution_map") as? SupportNavigationFragment
                ?: SupportNavigationFragment.newInstance().also { supportFragmentManager.commitNow { replace(containerId, it, "execution_map") } }
            fragment.getMapAsync { ready ->
                map = ready
                ready.setPadding(0, 0, 0, chromeHeight)
                ready.setMapStyle(MapStyleOptions.loadRawResourceStyle(this, R.raw.driver_map_style))
                ready.setOnMarkerClickListener { marker ->
                    if (!editing) {
                        val ids = (marker.tag as? List<*>)?.filterIsInstance<String>().orEmpty()
                        if (ids.size == 1) selectStop(ids[0]) else showStops = true
                    }
                    true
                }
                ready.setOnMapLongClickListener { point -> if (editing && !model.state.busy) draftPoint = ExecutionPoint(point.latitude, point.longitude) }
                ready.setOnMarkerDragListener(object : GoogleMap.OnMarkerDragListener {
                    override fun onMarkerDragStart(marker: Marker) = Unit
                    override fun onMarkerDrag(marker: Marker) { if (editing) draftPoint = ExecutionPoint(marker.position.latitude, marker.position.longitude) }
                    override fun onMarkerDragEnd(marker: Marker) { if (editing) draftPoint = ExecutionPoint(marker.position.latitude, marker.position.longitude) }
                })
                startGps()
                renderMap()
            }
        } else navMessage = "Falta configurar la clave Android de Google Maps. El mapa no está disponible todavía."
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch { model.observe() }
                launch { while (isActive) { model.sync(); delay(30_000) } }
                launch { while (isActive) { tick = SystemClock.elapsedRealtime(); delay(1000) } }
            }
        }
        if (!precisePermission()) permission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString("selected_stop", selectedId)
        val root = findViewById<FrameLayout>(android.R.id.content).getChildAt(0)
        (root.tag as? Int)?.let { outState.putInt("map_container", it) }
        super.onSaveInstanceState(outState)
    }
    private fun precisePermission() = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    @SuppressLint("MissingPermission")
    private fun startGps() {
        if (!precisePermission() || !lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) { gps = null; return }
        locations.removeUpdates(locationListener)
        for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
            if (locations.allProviders.contains(provider)) locations.requestLocationUpdates(provider, 1000L, 0f, locationListener, Looper.getMainLooper())
        }
        map?.isMyLocationEnabled = true
    }
    override fun onStart() { super.onStart(); startGps() }
    override fun onStop() { locations.removeUpdates(locationListener); gps = null; super.onStop() }
    override fun onResume() {
        super.onResume()
        if (DriverPreferences(applicationContext).keepRouteAwake) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
    override fun onDestroy() {
        requestGeneration++
        clearMap()
        map?.setOnMarkerClickListener(null)
        map?.setOnMarkerDragListener(null)
        map?.setOnMapLongClickListener(null)
        map = null
        NavigationRegistry.releaseIfInactive(navigator)
        super.onDestroy()
    }
    private fun connectNavigator() {
        if (navigator != null || connecting || noticeRequired || !precisePermission() || BuildConfig.NAVIGATION_API_KEY.isBlank() || model.state.execution == null || model.state.retired) return
        connecting = true
        NavigationApi.getNavigator(this, object : NavigationApi.NavigatorListener {
            override fun onNavigatorReady(ready: Navigator) {
                connecting = false
                if (isDestroyed || model.state.retired) { if (!ready.isGuidanceRunning) ready.cleanup(); return }
                if (!NavigationRegistry.attach(ready)) { navMessage = "Otra guía sigue activa. Regresa a la ruta correspondiente."; return }
                navigator = ready
                guidance = ready.isGuidanceRunning
                if (guidance) {
                    val active = model.state.execution?.stops?.find { destinationKey(it) == NavigationRegistry.destinationKey }
                    if (active == null) stopGuidance() else selectedId = active.id
                }
            }
            override fun onError(code: Int) { connecting = false; navMessage = "Google no pudo iniciar el mapa de navegación (código $code). Revisa la conexión y configuración." }
        })
    }
    private fun destinationKey(stop: ExecutionStop) = "${model.state.execution?.id}:${stop.id}:${stop.point?.latitude}:${stop.point?.longitude}"
    private fun stopGuidance() {
        requestGeneration++
        navigating = false
        navigator?.stopGuidance()
        navigator?.clearDestinations()
        guidance = false
        NavigationRegistry.destinationKey = null
    }
    private fun guide(stop: ExecutionStop) {
        val nav = navigator ?: return
        val point = stop.point ?: return
        if (navigating || noticeRequired || !model.state.verified || model.state.retired || editing) return
        val key = destinationKey(stop)
        if (guidance && NavigationRegistry.destinationKey == key) return
        val generation = ++requestGeneration
        navigating = true
        navMessage = "Calculando guía a esta parada…"
        val waypoint = Waypoint.builder().setLatLng(point.latitude, point.longitude).setTitle(stop.customer).build()
        nav.setDestination(waypoint, RoutingOptions()).setOnResultListener { result ->
            runOnUiThread {
                when (guidanceResultDecision(generation, requestGeneration, key, currentStop?.let(::destinationKey), model.state.retired, isDestroyed)) {
                    GuidanceResultDecision.IGNORE -> return@runOnUiThread
                    GuidanceResultDecision.DESTINATION_CHANGED -> {
                        stopGuidance()
                        navMessage = "El destino cambió. Revisa el punto actualizado e inicia la guía de nuevo."
                        renderMap()
                        return@runOnUiThread
                    }
                    GuidanceResultDecision.CURRENT -> Unit
                }
                navigating = false
                if (result == Navigator.RouteStatus.OK) {
                    NavigationRegistry.destinationKey = key
                    nav.startGuidance()
                    guidance = true
                    navMessage = "Guía activa · el orden de tus pedidos no cambia"
                } else { guidance = false; navMessage = "No se pudo trazar la guía: $result. Puedes reintentar sin volver a guardar el punto." }
                renderMap()
            }
        }
    }
    private fun selectStop(id: String) {
        if (navigating || model.state.busy || editing || selectedId == id) return
        stopGuidance()
        selectedId = id
        showStops = false
        renderMap()
        currentStop?.point?.let { map?.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(it.latitude, it.longitude), 16f)) }
    }
    private fun beginEdit() {
        val stop = currentStop ?: return
        resumeGuide = guidance
        navigator?.stopGuidance()
        guidance = false
        editing = true
        editRevision = model.state.execution?.revision
        editCustomerVersion = stop.customerLocationVersion
        draftPoint = stop.point ?: gps?.point
        renderMap()
        draftPoint?.let { map?.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(it.latitude, it.longitude), 18f)) }
    }
    private fun endEdit() {
        editing = false
        draftPoint = null
        if (resumeGuide && currentStop?.let(::destinationKey) == NavigationRegistry.destinationKey) {
            navigator?.startGuidance(); guidance = true
        }
        resumeGuide = false
        renderMap()
    }
    private fun clearMap() {
        markers.forEach { it.remove() }; markers.clear()
        lines.forEach { it.remove() }; lines.clear()
        radius?.remove(); radius = null
        editorMarker?.remove(); editorMarker = null
    }
    private fun markerIcon(label: String, active: Boolean, arrived: Boolean): BitmapDescriptor {
        val bitmap = Bitmap.createBitmap(96, 72, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.color = android.graphics.Color.parseColor(if (active) "#D0F58A" else if (arrived) "#9BCDF6" else "#30353C")
        canvas.drawRoundRect(4f, 4f, 92f, 64f, 23f, 23f, paint)
        paint.color = android.graphics.Color.parseColor(if (active || arrived) "#1D2B10" else "#F4F5F1")
        paint.textSize = 29f; paint.textAlign = Paint.Align.CENTER; paint.isFakeBoldText = true
        canvas.drawText(label, 48f, 44f, paint)
        return BitmapDescriptorFactory.fromBitmap(bitmap)
    }
    private fun renderMap() {
        val ready = map ?: return
        clearMap()
        val execution = model.state.execution ?: return
        if (model.state.retired) return
        if (!guidance && !execution.hasCorrections) model.state.route?.previewSegments?.forEach { encoded ->
            val points = decodePreviewPolyline(encoded)
            if (points.size > 1) lines.add(ready.addPolyline(PolylineOptions().addAll(points.map { LatLng(it.latitude, it.longitude) })
                .color(android.graphics.Color.rgb(147, 190, 90)).width(7f)))
        }
        val groups = execution.stops.filter { it.point != null }.groupBy { it.point }
        for ((point, group) in groups) {
            val p = point!!
            val label = if (group.size == 1) group[0].position.toString() else "${group.size}×"
            ready.addMarker(MarkerOptions().position(LatLng(p.latitude, p.longitude)).anchor(.5f, .5f)
                .title(group.joinToString(" · ") { "${it.position}. ${it.customer}" })
                .icon(markerIcon(label, group.any { it.id == selectedId }, group.all { it.arrivedAt != null })))?.let {
                    it.tag = group.map { stop -> stop.id }; markers.add(it)
                }
        }
        val point = if (editing) draftPoint else currentStop?.point
        if (point != null) {
            radius = ready.addCircle(CircleOptions().center(LatLng(point.latitude, point.longitude))
                .radius(execution.policy.radiusMeters.toDouble()).strokeWidth(2f)
                .strokeColor(android.graphics.Color.parseColor("#88D0F58A")).fillColor(android.graphics.Color.parseColor("#18D0F58A")))
            if (editing) editorMarker = ready.addMarker(MarkerOptions().position(LatLng(point.latitude, point.longitude))
                .draggable(true).title("Arrastra al domicilio correcto").icon(BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_VIOLET)))
        }
        if (!hasFitted && groups.isNotEmpty() && !guidance) {
            hasFitted = true
            val bounds = LatLngBounds.builder()
            groups.keys.filterNotNull().forEach { bounds.include(LatLng(it.latitude, it.longitude)) }
            ready.moveCamera(CameraUpdateFactory.newLatLngBounds(bounds.build(), resources.displayMetrics.widthPixels,
                (resources.displayMetrics.heightPixels - chromeHeight).coerceAtLeast(240), 60))
        }
    }

    @Composable
    private fun Chrome() {
        val state = model.state
        val execution = state.execution
        val stop = currentStop
        val eligibility = execution?.let { arrivalEligibility(gps, if (editing) draftPoint else stop?.point, it.policy, tick) }
        val available = state.verified && !state.busy && !state.pending && !state.retired
        val editConflict = editing && (editRevision != execution?.revision || editCustomerVersion != stop?.customerLocationVersion)
        val maxHeight = with(LocalDensity.current) { (LocalWindowInfo.current.containerSize.height * .56f).toDp() }
        LaunchedEffect(execution?.revision, execution?.policy?.version, state.retired) {
            if (state.retired) { navigating = false; guidance = false; navigator = null; editing = false; showOrder = false; showStops = false; renderMap() }
            else if (execution != null) {
                if (execution.stops.none { it.id == selectedId }) selectedId = execution.stops.firstOrNull { it.arrivedAt == null }?.id ?: execution.stops.firstOrNull()?.id.orEmpty()
                renderMap()
                connectNavigator()
                currentStop?.let { if (guidance && NavigationRegistry.destinationKey != destinationKey(it)) guide(it) }
            }
        }
        LaunchedEffect(draftPoint) {
            draftPoint?.let { point ->
                val position = LatLng(point.latitude, point.longitude)
                editorMarker?.position = position
                radius?.center = position
            }
        }
        LaunchedEffect(state.arrivedStop) {
            state.arrivedStop?.let { stopGuidance(); selectedId = it; showOrder = true; renderMap(); model.consumeArrival() }
        }
        LaunchedEffect(state.correctedStop) {
            state.correctedStop?.let {
                val restart = resumeGuide
                resumeGuide = false; editing = false; draftPoint = null
                renderMap()
                if (restart) currentStop?.let(::guide)
                model.consumeCorrection()
            }
        }
        Surface(color = DriverColors.surface, shape = RoundedCornerShape(topStart = 26.dp, topEnd = 26.dp),
            border = BorderStroke(1.dp, DriverColors.line), modifier = Modifier.navigationBarsPadding()) {
            Column(Modifier.fillMaxWidth().heightIn(max = maxHeight).verticalScroll(rememberScrollState()).padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Wordmark()
                    Spacer(Modifier.weight(1f))
                    StatusBadge(if (eligibility == ArrivalEligibility.READY) "GPS listo" else "GPS", if (eligibility == ArrivalEligibility.READY) DriverColors.lime else DriverColors.amber)
                    AppIconButton(DriverIcon.CLOSE, "Cerrar mapa", onClick = ::finish)
                }
                Text(state.message, style = MaterialTheme.typography.bodySmall, color = if (state.verified) DriverColors.muted else DriverColors.amber)
                if (navMessage.isNotBlank()) Text(navMessage, style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
                if (state.retired) AppAction("Volver a Inicio", DriverIcon.HOME, onClick = ::finish)
                else if (execution != null && stop != null) {
                    Text(if (editing) "CORREGIR UBICACIÓN" else "PARADA ${stop.position} DE ${execution.stops.size} · ${state.route?.vehicle.orEmpty()}",
                        style = MaterialTheme.typography.labelSmall, color = DriverColors.lime)
                    Text(stop.customer, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(stop.address, style = MaterialTheme.typography.bodySmall, color = DriverColors.muted, maxLines = 2)
                    if (editing) {
                        Text("Arrastra el pin morado o mantén pulsado el mapa. Se actualizará también el cliente para futuras rutas.",
                            style = MaterialTheme.typography.bodySmall, color = DriverColors.purple)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            AppAction("Mi ubicación", DriverIcon.PIN, Modifier.weight(1f), enabled = gps != null && !state.busy, quiet = true) { draftPoint = gps?.point }
                            AppAction("Cancelar", DriverIcon.CLOSE, Modifier.weight(1f), enabled = !state.busy, quiet = true, onClick = ::endEdit)
                        }
                        if (editConflict) Text("La ruta o el cliente cambió mientras editabas. Cancela esta edición y revisa el punto actualizado.",
                            style = MaterialTheme.typography.bodySmall, color = DriverColors.amber)
                        AppAction("Confirmar punto", DriverIcon.CHECK, Modifier.fillMaxWidth(), enabled = available && !editConflict && eligibility == ArrivalEligibility.READY) {
                            model.submit(stop.id, gps, draftPoint)
                        }
                    } else {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (stop.arrivedAt == null) AppAction("Llegué", DriverIcon.CHECK, Modifier.weight(1f), enabled = available && eligibility == ArrivalEligibility.READY) {
                                model.submit(stop.id, gps, null)
                            } else AppAction("Atender pedido", DriverIcon.ORDERS, Modifier.weight(1f)) { showOrder = true }
                            AppAction(if (guidance) "En guía" else "Iniciar guía", DriverIcon.ROUTE, Modifier.weight(1f),
                                enabled = available && navigator != null && !navigating && !guidance) { guide(stop) }
                        }
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            TextButton(enabled = available && !navigating && !stop.customerArchived, onClick = ::beginEdit) { Text("Mal punteado") }
                            TextButton(enabled = !state.busy && !navigating, onClick = { showStops = true }) { Text("Ver paradas") }
                            TextButton(onClick = { showOrder = true }) { Text("Pedido") }
                        }
                    }
                    val proximity = when (eligibility) {
                        ArrivalEligibility.READY -> "Dentro del radio de ${execution.policy.radiusMeters} m · GPS ±${gps?.accuracy?.toInt()} m"
                        ArrivalEligibility.OUTSIDE -> "Acércate al punto · radio ${execution.policy.radiusMeters} m incluyendo precisión GPS"
                        ArrivalEligibility.IMPRECISE -> "Esperando precisión GPS ≤ ${execution.policy.maxAccuracyMeters} m"
                        ArrivalEligibility.UNTRUSTED -> "Se necesita una ubicación real, no simulada"
                        ArrivalEligibility.MISSING_POINT -> "Sin punto confirmado. Usa Mal punteado"
                        else -> "Esperando ubicación GPS reciente"
                    }
                    Text(proximity, style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
                    if (execution.hasCorrections && !guidance) Text("Puntos actualizados. La guía al destino se calcula al iniciarla; el trazo original no se muestra como vigente.",
                        style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
                }
                if (!precisePermission()) TextButton(onClick = { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:$packageName"))) }) { Text("Activar ubicación precisa") }
                if (state.pending) AppAction("Verificar confirmación", DriverIcon.REFRESH, enabled = !state.busy, onClick = model::retry)
                else if (!state.verified && !state.retired) TextButton(onClick = model::refresh) { Text("Reintentar conexión") }
            }
        }
        if (showStops && execution != null) DetailSurface({ showStops = false }) {
            SectionLabel("Tus paradas", "${execution.stops.size}")
            Text("Elegir destino sólo cambia la guía. No reordena pedidos ni confirma entregas.", color = DriverColors.muted, style = MaterialTheme.typography.bodySmall)
            execution.stops.forEach { item -> ActionRow(if (item.arrivedAt != null) DriverIcon.CHECK else DriverIcon.PIN,
                "${item.position} · ${item.customer}", if (item.arrivedAt != null) "Llegada registrada" else item.address) { selectStop(item.id); showStops = false } }
        }
        if (showOrder && stop != null && execution != null) StopAttentionSheet(stop, state.route, execution.timezone) { showOrder = false }
        if (noticeRequired && !state.retired && BuildConfig.NAVIGATION_API_KEY.isNotBlank()) NavigationSafetyNotice(
            onAccepted = { noticeRequired = false; connectNavigator() }, onNotNow = ::finish,
        )
    }
    companion object { const val EXTRA_PLAN_ID = "route_plan_id" }
}

@Composable
private fun StopAttentionSheet(stop: ExecutionStop, route: AssignedPlan?, timezone: String, close: () -> Unit) {
    DetailSurface(close) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("PARADA ${stop.position}", style = MaterialTheme.typography.labelSmall, color = DriverColors.lime)
                Text(stop.customer, style = MaterialTheme.typography.titleLarge)
            }
            AppIconButton(DriverIcon.CLOSE, "Cerrar atención", onClick = close)
        }
        stop.arrivedAt?.let { StatusBadge("Llegada · ${formatRouteTime(it, timezone)}") }
        Text(if (stop.arrivedAt != null) "Llegada confirmada. Revisa los productos para comenzar la atención." else "Consulta del pedido. Registra Llegué cuando estés en el domicilio.",
            color = DriverColors.muted, style = MaterialTheme.typography.bodyMedium)
        for (order in route?.orders.orEmpty().filter { it.id in stop.shipmentIds }) {
            HorizontalDivider(color = DriverColors.line)
            SectionLabel(order.name, "${order.lines.size} partidas")
            if (order.note.isNotBlank()) Text(order.note, color = DriverColors.amber, style = MaterialTheme.typography.bodyMedium)
            order.lines.forEach { line ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Text(line.name, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                    Text("${line.quantity} ${line.unit}", style = MaterialTheme.typography.labelLarge, color = DriverColors.lime)
                }
            }
        }
        Text("La entrega aún no se ha marcado como completada.", color = DriverColors.muted, style = MaterialTheme.typography.bodySmall)
    }
}
