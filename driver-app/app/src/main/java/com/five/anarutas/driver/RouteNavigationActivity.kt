package com.five.anarutas.driver

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.fragment.app.commitNow
import androidx.lifecycle.lifecycleScope
import com.google.android.libraries.navigation.NavigationApi
import com.google.android.libraries.navigation.Navigator
import com.google.android.libraries.navigation.RoutingOptions
import com.google.android.libraries.navigation.SupportNavigationFragment
import com.google.android.libraries.navigation.Waypoint
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.GoogleMap
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.Marker
import com.google.android.gms.maps.model.MarkerOptions
import com.google.android.gms.maps.model.Polyline
import com.google.android.gms.maps.model.PolylineOptions
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Uses the Navigation SDK's live map and turn UI. No route is requested until the driver taps Guide. */
class RouteNavigationActivity : FragmentActivity() {
    private val progressStore by lazy { NavigationProgressStore(applicationContext) }
    private var route by mutableStateOf<AssignedPlan?>(null)
    private var message by mutableStateOf("Cargando ruta publicada…")
    private var loading by mutableStateOf(true)
    private var guidanceRunning by mutableStateOf(false)
    private var selectedIndex by mutableIntStateOf(0)
    private var arrivedIndex by mutableIntStateOf(-1)
    private var batchEndExclusive = 0
    private var routeRequestInFlight = false
    private var showOrderDetail by mutableStateOf(false)
    private var showStopPicker by mutableStateOf(false)
    private var foreignGuidance by mutableStateOf(false)
    private var navigator: Navigator? = null
    private var previewMap: GoogleMap? = null
    private var chromeHeight = 0
    private val previewLines = mutableListOf<Polyline>()
    private var previewMarker: Marker? = null
    private val arrivalListener = Navigator.ArrivalListener { event ->
        runOnUiThread {
            val current = route?.orders?.indexOfFirst { order ->
                val point = event.waypoint.position
                point != null && order.position >= (route?.orders?.getOrNull(selectedIndex)?.position ?: 0) &&
                    order.latitude == point.latitude && order.longitude == point.longitude
            } ?: -1
            if (current >= 0) {
                selectedIndex = current
                arrivedIndex = current
                route?.let { plan ->
                    if (batchEndExclusive > current)
                        progressStore.save(plan, NavigationProgress(current, batchEndExclusive))
                }
                message = "Llegaste a ${route?.orders?.getOrNull(current)?.customer}. Revisa el pedido antes de continuar."
            }
        }
    }
    private val locationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) connectNavigation() else {
            loading = false
            message = "Activa el permiso de ubicación precisa para navegar la ruta."
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val containerId = View.generateViewId()
        val root = FrameLayout(this).apply { setBackgroundColor(android.graphics.Color.rgb(12, 16, 13)) }
        val mapContainer = FrameLayout(this).apply { id = containerId }
        root.addView(mapContainer, FrameLayout.LayoutParams(-1, -1))
        val chrome = ComposeView(this).apply { setContent { NavigationChrome() } }
        chrome.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
            if (chromeHeight != chrome.height) {
                chromeHeight = chrome.height
                previewMap?.setPadding(0, 0, 0, chromeHeight)
            }
        }
        root.addView(chrome, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
        setContentView(root)

        val planId = intent.getStringExtra(EXTRA_PLAN_ID)
        if (planId.isNullOrBlank()) {
            loading = false
            message = "No se recibió una ruta válida."
            return
        }
        if (BuildConfig.NAVIGATION_API_KEY.isBlank()) {
            loading = false
            message = "Administración debe configurar la clave Android de navegación."
            return
        }
        val mapFragment = SupportNavigationFragment.newInstance()
        supportFragmentManager.commitNow { replace(containerId, mapFragment) }
        mapFragment.getMapAsync { map ->
            previewMap = map
            map.setPadding(0, 0, 0, chromeHeight)
            renderPreview()
        }
        lifecycleScope.launch {
            try {
                val saved = withContext(Dispatchers.IO) { DeviceCredentials(applicationContext).load() }
                if (saved.token.isBlank()) {
                    message = "Tu sesión terminó. Vuelve a ingresar en la app."
                    return@launch
                }
                val fresh = DriverApi(BuildConfig.SERVER_URL).plan(saved.token, planId)
                if (fresh.startedAt == null) {
                    message = "Inicia la ruta después de cargar cinco fotos de la unidad."
                    return@launch
                }
                val invalid = fresh.orders.firstOrNull { !hasValidNavigationPoint(it) }
                if (invalid != null) {
                    message = "Falta confirmar el punto de ${invalid.customer}. Administración debe corregirlo."
                    return@launch
                }
                route = fresh
                renderPreview()
                if (fresh.orders.isEmpty()) {
                    message = "La ruta no tiene paradas para navegar."
                    return@launch
                }
                if (ContextCompat.checkSelfPermission(this@RouteNavigationActivity,
                        Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    connectNavigation()
                } else locationPermission.launch(Manifest.permission.ACCESS_FINE_LOCATION)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                message = friendlyError(failure)
            } finally {
                loading = false
            }
        }
    }

    private fun connectNavigation() {
        if (navigator != null || route == null) return
        loading = true
        NavigationApi.getNavigator(this, object : NavigationApi.NavigatorListener {
            override fun onNavigatorReady(ready: Navigator) {
                if (isDestroyed) {
                    if (!ready.isGuidanceRunning) ready.cleanup()
                    return
                }
                if (!NavigationRegistry.attach(ready)) {
                    if (!ready.isGuidanceRunning) ready.cleanup()
                    message = "Hay otra guía activa. Termínala antes de abrir esta ruta."
                    loading = false
                    return
                }
                navigator = ready
                ready.addArrivalListener(arrivalListener)
                guidanceRunning = ready.isGuidanceRunning
                if (guidanceRunning) {
                    clearPreview()
                    foreignGuidance = route?.let { !progressStore.isActive(it) } ?: true
                    if (foreignGuidance) {
                        message = "Hay una guía activa de otra ruta. Termínala antes de navegar esta."
                        loading = false
                        return
                    }
                    route?.let { plan ->
                        progressStore.read(plan)?.let { progress ->
                            selectedIndex = progress.currentIndex
                            batchEndExclusive = progress.batchEndExclusive
                        }
                    }
                    val destination = ready.currentRouteSegment?.destinationWaypoint?.position
                    val index = destination?.let { point ->
                        route?.orders?.indexOfFirst {
                            it.latitude == point.latitude && it.longitude == point.longitude
                        }
                    } ?: -1
                    if (index >= 0) {
                        selectedIndex = index
                        route?.let { plan ->
                            if (batchEndExclusive > index)
                                progressStore.save(plan, NavigationProgress(index, batchEndExclusive))
                        }
                    }
                    message = "Guía activa. Sigue las indicaciones del mapa."
                } else message = "Mapa listo. Inicia la guía cuando vayas a salir."
                loading = false
            }

            override fun onError(code: Int) {
                loading = false
                message = "No se pudo iniciar la navegación (código $code). Revisa conexión, GPS y configuración."
            }
        })
    }

    private fun guideFrom(index: Int) {
        val activeRoute = route ?: return
        val nav = navigator ?: return
        if (routeRequestInFlight || guidanceRunning || foreignGuidance || index !in activeRoute.orders.indices) return
        val batch = navigationBatch(activeRoute.orders, index)
        val waypoints = batch.map { order ->
            Waypoint.builder().setLatLng(order.latitude!!, order.longitude!!)
                .setTitle(order.customer).build()
        }
        routeRequestInFlight = true
        loading = true
        message = "Buscando recorrido real…"
        clearPreview()
        nav.setDestinations(waypoints, RoutingOptions()).setOnResultListener { result ->
            runOnUiThread {
                routeRequestInFlight = false
                loading = false
                if (result == Navigator.RouteStatus.OK) {
                    selectedIndex = index
                    arrivedIndex = -1
                    batchEndExclusive = index + batch.size
                    nav.startGuidance()
                    progressStore.save(activeRoute, NavigationProgress(index, batchEndExclusive))
                    guidanceRunning = true
                    message = "Guía activa. Sigue las indicaciones del mapa."
                } else {
                    renderPreview()
                    message = "No se pudo trazar la ruta: $result. Verifica GPS, internet y puntos."
                }
            }
        }
    }

    private fun continueAfterArrival() {
        val activeRoute = route ?: return
        val nav = navigator ?: return
        val next = arrivedIndex + 1
        if (arrivedIndex < 0 || next > activeRoute.orders.size) return
        if (batchEndExclusive == 0) {
            message = "No se recuperó el progreso de esta guía. Cierra y vuelve a abrir el mapa antes de continuar."
            return
        }
        arrivedIndex = -1
        if (next >= activeRoute.orders.size) {
            nav.stopGuidance()
            guidanceRunning = false
            progressStore.clear(activeRoute)
            renderPreview()
            message = "Llegaste a la última parada. La entrega se registra por separado."
            return
        }
        if (next >= batchEndExclusive) {
            nav.stopGuidance()
            guidanceRunning = false
            selectedIndex = next
            message = "Siguiente bloque listo. Pulsa Iniciar guía para continuar."
            return
        }
        if (nav.continueToNextDestination() == null) {
            guidanceRunning = false
            selectedIndex = next
            batchEndExclusive = 0
            progressStore.clear(activeRoute)
            message = "El SDK cerró este tramo. Pulsa Iniciar guía para la siguiente parada."
            return
        }
        selectedIndex = next
        progressStore.save(activeRoute, NavigationProgress(next, batchEndExclusive))
        message = "Siguiente parada: ${activeRoute.orders[next].customer}."
    }

    private fun changeNavigationStop(index: Int) {
        val activeRoute = route ?: return
        if (index !in activeRoute.orders.indices || routeRequestInFlight || foreignGuidance) return
        navigator?.clearDestinations()
        guidanceRunning = false
        selectedIndex = index
        arrivedIndex = -1
        batchEndExclusive = 0
        progressStore.clear(activeRoute)
        renderPreview()
        showStopPicker = false
        message = "Destino elegido: ${activeRoute.orders[index].customer}. Pulsa Iniciar guía cuando estés listo."
    }

    override fun onDestroy() {
        clearPreview()
        previewMap = null
        navigator?.removeArrivalListener(arrivalListener)
        NavigationRegistry.releaseIfInactive(navigator)
        super.onDestroy()
    }

    private fun clearPreview() {
        previewLines.forEach { it.remove() }
        previewLines.clear()
        previewMarker?.remove()
        previewMarker = null
    }

    private fun renderPreview() {
        val map = previewMap ?: return
        val plan = route ?: return
        if (guidanceRunning || isDestroyed) return
        clearPreview()
        for (encoded in plan.previewSegments) {
            val points = decodePreviewPolyline(encoded)
            if (points.size < 2) continue
            previewLines.add(map.addPolyline(PolylineOptions()
                .addAll(points.map { LatLng(it.latitude, it.longitude) })
                .color(android.graphics.Color.rgb(147, 205, 75)).width(8f)))
        }
        val current = plan.orders.getOrNull(selectedIndex) ?: return
        if (!hasValidNavigationPoint(current)) return
        val point = LatLng(current.latitude!!, current.longitude!!)
        previewMarker = map.addMarker(MarkerOptions().position(point)
            .title("${current.position} · ${current.customer}"))
        map.moveCamera(CameraUpdateFactory.newLatLngZoom(point, 14f))
    }

    @Composable
    private fun NavigationChrome() {
        val activeRoute = route
        MaterialTheme(colorScheme = darkColorScheme(primary = NAV_GREEN, surface = NAV_PANEL,
            onSurface = Color.White, onPrimary = Color(0xFF17200C))) {
            Surface(color = NAV_PANEL, shape = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp),
                border = BorderStroke(1.dp, NAV_BORDER), modifier = Modifier.navigationBarsPadding()) {
                Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 18.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(activeRoute?.label ?: "Mapa de ruta", fontSize = 15.sp, fontWeight = FontWeight.Bold,
                                maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(activeRoute?.let { "${it.vehicle} · ${it.orders.size} paradas" } ?: "Navegación",
                                color = NAV_MUTED, fontSize = 11.sp)
                        }
                        OutlinedButton(onClick = ::finish, modifier = Modifier.height(36.dp),
                            contentPadding = PaddingValues(horizontal = 12.dp)) { Text("Cerrar", fontSize = 11.sp) }
                    }
                    Text(message, color = if (loading) NAV_MUTED else NAV_GREEN, fontSize = 12.sp)
                    if (activeRoute != null && activeRoute.orders.isNotEmpty()) {
                        val current = activeRoute.orders.getOrNull(selectedIndex)
                        if (current != null) {
                            Text("PARADA ${current.position} DE ${activeRoute.orders.size}",
                                color = NAV_GREEN, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                            Text(current.customer, fontSize = 19.sp, fontWeight = FontWeight.Bold,
                                maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(current.address, color = NAV_MUTED, fontSize = 11.sp,
                                maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (arrivedIndex >= 0) {
                                Button(onClick = ::continueAfterArrival, modifier = Modifier.height(38.dp),
                                    contentPadding = PaddingValues(horizontal = 14.dp)) {
                                    Text("Continuar", fontSize = 12.sp)
                                }
                            } else if (!guidanceRunning && navigator != null && !foreignGuidance) {
                                Button(onClick = { guideFrom(selectedIndex) }, enabled = !loading,
                                    modifier = Modifier.height(38.dp), contentPadding = PaddingValues(horizontal = 14.dp)) {
                                    Text("Iniciar guía", fontSize = 12.sp)
                                }
                            }
                            OutlinedButton(onClick = { showOrderDetail = true }, enabled = current != null,
                                modifier = Modifier.height(38.dp),
                                contentPadding = PaddingValues(horizontal = 14.dp)) { Text("Ver pedido", fontSize = 12.sp) }
                        }
                        if (guidanceRunning && !foreignGuidance)
                            TextButton(onClick = { showStopPicker = true },
                                contentPadding = PaddingValues(horizontal = 0.dp, vertical = 0.dp)) {
                                Text("Cambiar parada de navegación", color = NAV_GREEN, fontSize = 11.sp)
                            }
                        if (!guidanceRunning && !loading && activeRoute.orders.size > 1) {
                            Text("Elige la próxima parada antes de iniciar la guía", color = NAV_MUTED, fontSize = 10.sp)
                            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                activeRoute.orders.forEachIndexed { index, order ->
                                    Surface(color = if (index == selectedIndex) NAV_GREEN.copy(alpha = 0.2f) else NAV_PANEL,
                                        shape = RoundedCornerShape(10.dp), border = BorderStroke(1.dp,
                                            if (index == selectedIndex) NAV_GREEN else NAV_BORDER),
                                        modifier = Modifier.clickable { selectedIndex = index; renderPreview() }) {
                                        Text("${order.position} · ${order.customer}", fontSize = 11.sp,
                                            maxLines = 1, modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp))
                                    }
                                }
                            }
                        }
                        if (showOrderDetail && current != null)
                            OrderDetailDialog(current) { showOrderDetail = false }
                        if (showStopPicker) {
                            AlertDialog(
                                onDismissRequest = { showStopPicker = false },
                                title = { Text("Cambiar parada", fontSize = 17.sp) },
                                text = {
                                    Column {
                                        Text("Sólo cambia el destino del mapa. No mueve pedidos ni registra entregas.",
                                            color = NAV_MUTED, fontSize = 12.sp)
                                        Column(Modifier.height(300.dp).verticalScroll(rememberScrollState())) {
                                            activeRoute.orders.forEachIndexed { index, order ->
                                                TextButton(onClick = { changeNavigationStop(index) }) {
                                                    Text("${order.position} · ${order.customer}", fontSize = 12.sp,
                                                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                                                }
                                            }
                                        }
                                    }
                                },
                                confirmButton = {
                                    TextButton(onClick = { showStopPicker = false }) { Text("Cancelar") }
                                },
                            )
                        }
                    }
                }
            }
        }
    }

    companion object {
        const val EXTRA_PLAN_ID = "route_plan_id"
    }
}

private val NAV_PANEL = Color(0xFF171E19)
private val NAV_GREEN = Color(0xFF93CD4B)
private val NAV_MUTED = Color(0xFFAEB9AF)
private val NAV_BORDER = Color(0xFF344137)
