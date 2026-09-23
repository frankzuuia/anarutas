package com.five.anarutas.driver

import android.os.Bundle
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay

private val backdrop = Color(0xFF0C100D)
private val panel = Color(0xFF171E19)
private val panelRaised = Color(0xFF202A22)
private val green = Color(0xFF93CD4B)
private val greenSoft = Color(0xFF25371D)
private val muted = Color(0xFFAEB9AF)
private val border = Color(0xFF344137)
private val danger = Color(0xFFFFB3AE)
private val warning = Color(0xFFFFD166)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val credentials = DeviceCredentials(applicationContext)
        setContent {
            val model: DriverViewModel = viewModel(factory = DriverViewModel.factory(credentials))
            DriverApp(model)
        }
    }
}

@Composable
private fun DriverApp(model: DriverViewModel) {
    val state = model.state
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = green,
            onPrimary = Color(0xFF17200C),
            background = backdrop,
            onBackground = Color.White,
            surface = panel,
            onSurface = Color.White,
            error = danger,
        ),
    ) {
        Surface(modifier = Modifier.fillMaxSize(), color = backdrop) {
            when {
                state.initializing -> LoadingScreen()
                state.token.isBlank() -> AccessScreen(state, model)
                else -> DriverShell(state, model)
            }
        }
    }
}

@Composable
private fun LoadingScreen() {
    Column(
        modifier = Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator(color = green, modifier = Modifier.size(34.dp))
        Spacer(Modifier.height(14.dp))
        Text("Abriendo tu sesión segura…", color = muted)
    }
}

@Composable
private fun BrandHeader() {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Text("Five", fontSize = 31.sp, fontWeight = FontWeight.Bold, color = Color.White)
        Spacer(Modifier.weight(1f))
        Text("ANA RUTAS · CHOFER", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = green)
    }
}

@Composable
private fun AccessScreen(state: DriverUiState, model: DriverViewModel) {
    Column(
        modifier = Modifier.fillMaxSize().safeDrawingPadding()
            .verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        BrandHeader()
        StatusMessages(state)
        Text("Acceso a tu ruta", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text("Introduce el teléfono registrado por administración y tu PIN.", color = muted)
        OutlinedTextField(
            value = state.phone,
            onValueChange = model::updatePhone,
            label = { Text("Teléfono del chofer") },
            placeholder = { Text("10 dígitos") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = state.pin,
            onValueChange = model::updatePin,
            label = { Text("PIN de 4 dígitos") },
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Button(
            enabled = !state.busy,
            modifier = Modifier.height(50.dp),
            contentPadding = PaddingValues(horizontal = 28.dp),
            onClick = model::submitAccess,
        ) { Text(if (state.busy) "Conectando…" else "Entrar") }
        if (state.deviceId.isNotBlank()) {
            TextButton(enabled = !state.busy, onClick = model::reactivateDevice) {
                Text("Cambiar o reactivar celular")
            }
        }
        Text(
            "El PIN nunca se guarda. El primer acceso vincula automáticamente este celular.",
            color = muted,
            fontSize = 12.sp,
        )
    }
}

@Composable
private fun DriverShell(state: DriverUiState, model: DriverViewModel) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    LaunchedEffect(lifecycleOwner, state.token) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            model.syncDashboard()
            while (true) {
                delay(30_000L)
                model.syncDashboard()
            }
        }
    }
    val activeRoute = state.activePlan()
    val mapAvailable = activeRoute?.startedAt != null && BuildConfig.NAVIGATION_API_KEY.isNotBlank()
    val openMap: () -> Unit = {
        if (activeRoute != null) context.startActivity(Intent(context, RouteNavigationActivity::class.java)
            .putExtra(RouteNavigationActivity.EXTRA_PLAN_ID, activeRoute.id))
    }
    Scaffold(
        containerColor = backdrop,
        modifier = Modifier.fillMaxSize().safeDrawingPadding(),
        bottomBar = { DriverBottomBar(state.destination, mapAvailable, openMap, model::navigate) },
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding)
                .verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            BrandHeader()
            StatusMessages(state)
            if (state.busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = green)
            when (state.destination) {
                DriverDestination.HOME -> DashboardScreen(state, model)
                DriverDestination.ROUTE -> RouteScreen(state, model)
                DriverDestination.ORDERS -> OrdersScreen(state, model)
                DriverDestination.PROFILE -> ProfileScreen(state, model)
            }
        }
        if (state.showPhotos) UnitPhotosDialog(state, model)
        state.orderDetailId?.let { orderId ->
            state.activePlan()?.orders?.firstOrNull { it.id == orderId }?.let { order ->
                OrderDetailDialog(order, model::closeOrder)
            }
        }
    }
}

@Composable
private fun StatusMessages(state: DriverUiState) {
    if (state.error.isNotBlank()) {
        Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF452623))) {
            Text(state.error, color = danger, modifier = Modifier.padding(13.dp), fontSize = 13.sp)
        }
    }
    if (state.notice.isNotBlank()) {
        Card(colors = CardDefaults.cardColors(containerColor = greenSoft)) {
            Text(state.notice, color = green, modifier = Modifier.padding(13.dp), fontSize = 13.sp)
        }
    }
}

@Composable
private fun DriverBottomBar(
    selected: DriverDestination,
    mapAvailable: Boolean,
    onMap: () -> Unit,
    onSelect: (DriverDestination) -> Unit,
) {
    Surface(color = Color(0xFF121713), tonalElevation = 3.dp) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 5.dp),
            horizontalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            val tabs = listOf(
                DriverDestination.HOME to "Inicio",
                DriverDestination.ROUTE to "Ruta",
                DriverDestination.ORDERS to "Pedidos",
                DriverDestination.PROFILE to "Perfil",
            )
            tabs.forEachIndexed { index, (destination, label) ->
                if (index == 2 && mapAvailable) {
                    TextButton(
                        onClick = onMap,
                        modifier = Modifier.weight(1f).height(48.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.textButtonColors(containerColor = greenSoft, contentColor = green),
                        contentPadding = PaddingValues(horizontal = 4.dp),
                    ) { Text("Mapa", fontSize = 12.sp, fontWeight = FontWeight.Bold) }
                }
                TextButton(
                    onClick = { onSelect(destination) },
                    modifier = Modifier.weight(1f).height(48.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.textButtonColors(
                        containerColor = if (selected == destination) greenSoft else Color.Transparent,
                        contentColor = if (selected == destination) green else muted,
                    ),
                    contentPadding = PaddingValues(horizontal = 4.dp),
                ) {
                    Text(
                        label,
                        fontSize = 12.sp,
                        fontWeight = if (selected == destination) FontWeight.Bold else FontWeight.Medium,
                    )
                }
            }
        }
    }
}

@Composable
private fun DashboardScreen(state: DriverUiState, model: DriverViewModel) {
    val dashboard = state.dashboard
    when (dashboardLoadState(dashboard, state.busy)) {
        DashboardLoadState.LOADING -> {
            EmptyState("Preparando tu panel", "Estamos consultando tus rutas y métricas asignadas.")
            return
        }
        DashboardLoadState.FAILED -> {
            EmptyState("No se pudo cargar tu panel", "Usa Actualizar para volver a consultarlo.")
            OutlinedButton(onClick = model::refreshDashboard) { Text("Actualizar") }
            return
        }
        DashboardLoadState.READY -> Unit
    }
    dashboard ?: return
    val firstName = dashboard.driver.name.substringBefore(" ").ifBlank { "chofer" }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            "Hola, $firstName",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.semantics { heading() },
        )
        Text(formatServiceDate(dashboard.serviceDate), color = muted, fontSize = 13.sp)
    }
    SectionTitle("Ruta de hoy")
    val today = dashboard.today
    if (today == null) {
        EmptyState(
            "Sin ruta asignada para hoy",
            "Tu historial permanece disponible. Si te asignan una ruta, aparecerá al actualizar.",
        )
        OutlinedButton(enabled = !state.busy, onClick = model::refreshDashboard) { Text("Actualizar") }
    } else {
        TodayRouteCard(today, dashboard.timezone, state.busy, model)
    }
    val history = otherPlans(dashboard)
    if (history.isNotEmpty()) {
        SectionTitle("Otras rutas")
        history.forEach { summary -> HistoryRouteCard(summary, state.busy, model) }
    }
}

@Composable
private fun TodayRouteCard(
    route: AssignedPlan,
    timezone: String,
    busy: Boolean,
    model: DriverViewModel,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = panel),
        border = BorderStroke(1.dp, Color(0xFF30412D)),
        modifier = Modifier.fillMaxWidth().clickable { model.navigate(DriverDestination.ROUTE) },
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.Top, modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(route.label, fontWeight = FontWeight.Bold, fontSize = 20.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(vehicleLabel(route.vehicle, route.plate), color = muted, fontSize = 13.sp)
                }
                RouteStatusPill(route.routeStatus)
            }
            MetricGrid(route)
            val overview = route.overview
            if (overview != null) {
                HorizontalDivider(color = border)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    ScheduleValue("Salida", formatRouteTime(overview.departureAt, timezone))
                    ScheduleValue("Regreso estimado", formatRouteTime(overview.finishedAt, timezone), Alignment.End)
                }
            } else {
                routeStatusMessage(route.routeStatus)?.let { Text(it, color = warning, fontSize = 13.sp) }
            }
            route.orders.firstOrNull()?.let { next ->
                Surface(color = panelRaised, shape = RoundedCornerShape(14.dp)) {
                    Column(Modifier.padding(13.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("PRIMERA PARADA", color = green, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                        Text(next.customer, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(next.address, color = muted, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Button(enabled = !busy, onClick = { model.navigate(DriverDestination.ROUTE) }) { Text("Abrir ruta") }
                OutlinedButton(enabled = !busy, onClick = model::refreshDashboard) { Text("Actualizar") }
            }
        }
    }
}

@Composable
private fun MetricGrid(route: AssignedPlan) {
    val overview = route.overview
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        MetricTile("Pedidos", route.orders.size.toString(), Modifier.weight(1f))
        MetricTile("Paradas", overview?.stopCount?.toString() ?: "Pendiente", Modifier.weight(1f))
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        MetricTile("Distancia", formatRouteDistance(overview?.travelDistanceMeters), Modifier.weight(1f))
        MetricTile("Tiempo planeado", formatRouteDuration(overview?.totalDurationSeconds), Modifier.weight(1f))
    }
}

@Composable
private fun MetricTile(label: String, value: String, modifier: Modifier = Modifier) {
    Surface(modifier = modifier, color = panelRaised, shape = RoundedCornerShape(13.dp)) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(value, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 17.sp, maxLines = 1)
            Text(label, color = muted, fontSize = 11.sp, maxLines = 1)
        }
    }
}

@Composable
private fun ScheduleValue(label: String, value: String, alignment: Alignment.Horizontal = Alignment.Start) {
    Column(horizontalAlignment = alignment) {
        Text(label, color = muted, fontSize = 11.sp)
        Text(value, fontWeight = FontWeight.Bold, fontSize = 16.sp)
    }
}

@Composable
private fun HistoryRouteCard(summary: PlanSummary, busy: Boolean, model: DriverViewModel) {
    Card(colors = CardDefaults.cardColors(containerColor = panel), modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(summary.label, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    "${summary.date} · ${vehicleLabel(summary.vehicle, summary.plate)}",
                    color = muted,
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text("${summary.orderCount} pedidos", color = green, fontSize = 12.sp)
            }
            OutlinedButton(
                enabled = !busy,
                onClick = { model.selectPlan(summary.id) },
                contentPadding = PaddingValues(horizontal = 13.dp),
            ) { Text("Abrir", fontSize = 12.sp) }
        }
    }
}

@Composable
private fun RouteScreen(state: DriverUiState, model: DriverViewModel) {
    val context = LocalContext.current
    val route = state.activePlan()
    var confirmStart by remember(route?.id, route?.publicationRevision) { mutableStateOf(false) }
    ScreenHeading("Ruta", route?.let { "${it.date} · ${vehicleLabel(it.vehicle, it.plate)}" })
    if (route == null) {
        EmptyState("No hay una ruta para mostrar", "Selecciona una ruta desde Inicio o espera una asignación para hoy.")
        return
    }
    RouteStatusPill(route.routeStatus)
    routeStatusMessage(route.routeStatus)?.let { Text(it, color = warning, fontSize = 13.sp) }
    Card(colors = CardDefaults.cardColors(containerColor = panel), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
            Text(route.label, fontWeight = FontWeight.Bold, fontSize = 20.sp)
            MetricGrid(route)
            route.overview?.let { overview ->
                HorizontalDivider(color = border)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    ScheduleValue("Salida", formatRouteTime(overview.departureAt, state.dashboard?.timezone ?: "UTC"))
                    ScheduleValue(
                        "Regreso estimado",
                        formatRouteTime(overview.finishedAt, state.dashboard?.timezone ?: "UTC"),
                        Alignment.End,
                    )
                }
            }
        }
    }
    Surface(color = panel, shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, border)) {
        Row(
            Modifier.fillMaxWidth().padding(13.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Column(Modifier.weight(1f)) {
                Text("Fotos de la unidad", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                Text("${route.photoCount} de 8 · mínimo 5 para salir", color = muted, fontSize = 11.sp)
            }
            OutlinedButton(
                onClick = model::openPhotos,
                enabled = !state.busy,
                contentPadding = PaddingValues(horizontal = 12.dp),
                modifier = Modifier.height(38.dp),
            ) { Text("Ver fotos", fontSize = 11.sp) }
        }
    }
    if (route.startedAt == null) {
        Button(
            onClick = { confirmStart = true },
            enabled = !state.busy && route.photoCount >= 5 && route.orders.isNotEmpty(),
            modifier = Modifier.height(42.dp),
            contentPadding = PaddingValues(horizontal = 19.dp),
        ) { Text("Iniciar ruta", fontSize = 12.sp) }
        if (route.photoCount < 5)
            Text("Faltan ${5 - route.photoCount} fotos distintas para habilitar el inicio.", color = muted, fontSize = 11.sp)
        if (confirmStart) {
            Dialog(onDismissRequest = { confirmStart = false }) {
                Surface(
                    color = panel,
                    shape = RoundedCornerShape(18.dp),
                    border = BorderStroke(1.dp, border),
                ) {
                    Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
                        Text("¿Iniciar esta ruta?", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                        Text(route.label, color = green, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                        Text(
                            "${vehicleLabel(route.vehicle, route.plate)} · ${route.overview?.stopCount ?: route.orders.size} paradas · ${route.photoCount} fotos de la unidad",
                            color = muted, fontSize = 12.sp,
                        )
                        Text("Confirma sólo cuando estés listo para salir. El inicio quedará registrado y ya no podrás agregar fotos de salida.", color = muted, fontSize = 12.sp)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                            TextButton(onClick = { confirmStart = false }) { Text("Cancelar") }
                            Button(
                                enabled = !state.busy,
                                onClick = {
                                    confirmStart = false
                                    model.startRoute(route.id, route.publicationRevision)
                                },
                                modifier = Modifier.height(38.dp),
                                contentPadding = PaddingValues(horizontal = 14.dp),
                            ) { Text("Sí, iniciar", fontSize = 12.sp) }
                        }
                    }
                }
            }
        }
    } else {
        Text("Ruta iniciada", color = green, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        if (BuildConfig.NAVIGATION_API_KEY.isNotBlank()) {
            OutlinedButton(
                onClick = {
                    context.startActivity(Intent(context, RouteNavigationActivity::class.java)
                        .putExtra(RouteNavigationActivity.EXTRA_PLAN_ID, route.id))
                },
                modifier = Modifier.height(40.dp),
                contentPadding = PaddingValues(horizontal = 16.dp),
            ) { Text("Abrir mapa de ruta", fontSize = 12.sp) }
        } else Text("El mapa estará disponible cuando se configure la clave Android de navegación.",
            color = muted, fontSize = 11.sp)
    }
    SectionTitle("Secuencia de paradas")
    if (route.orders.isEmpty()) EmptyState("Ruta sin pedidos", "Administración no ha asignado pedidos a esta camioneta.")
    route.orders.forEach { order -> StopRow(order, state.dashboard?.timezone ?: "UTC") { model.showOrder(order.id) } }
    if (route.orders.isNotEmpty()) {
        OutlinedButton(onClick = { model.navigate(DriverDestination.ORDERS) }) { Text("Ver detalle de pedidos") }
    }
}

@Composable
private fun StopRow(order: DeliveryOrder, timezone: String, onClick: () -> Unit) {
    Surface(color = panel, shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, border), modifier = Modifier.clickable(onClick = onClick)) {
        Row(
            Modifier.fillMaxWidth().padding(13.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                Modifier.size(34.dp).background(greenSoft, RoundedCornerShape(11.dp)),
                contentAlignment = Alignment.Center,
            ) { Text(order.position.toString(), color = green, fontWeight = FontWeight.Bold) }
            Column(Modifier.weight(1f)) {
                Text(order.customer, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(order.address, color = muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            order.eta?.let { Text(formatRouteTime(it, timezone), color = green, fontSize = 12.sp) }
        }
    }
}

@Composable
private fun OrdersScreen(state: DriverUiState, model: DriverViewModel) {
    val route = state.activePlan()
    ScreenHeading("Pedidos", route?.let { "${it.orders.size} asignados · ${it.label}" })
    if (route == null) {
        EmptyState("No hay pedidos para mostrar", "Selecciona una ruta desde Inicio o espera una asignación para hoy.")
        return
    }
    if (route.orders.isEmpty()) EmptyState("Ruta sin pedidos", "Administración no ha asignado pedidos a esta camioneta.")
    route.orders.forEach { order -> OrderCard(order, state.dashboard?.timezone ?: "UTC") { model.showOrder(order.id) } }
    if (route.orders.isNotEmpty()) {
        OutlinedButton(onClick = { model.navigate(DriverDestination.ROUTE) }) { Text("Ver secuencia de ruta") }
    }
}

@Composable
private fun ProfileScreen(state: DriverUiState, model: DriverViewModel) {
    val driver = state.dashboard?.driver
    ScreenHeading("Perfil", "Acceso seguro del chofer")
    Card(colors = CardDefaults.cardColors(containerColor = panel), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(driver?.name ?: "Chofer", fontSize = 21.sp, fontWeight = FontWeight.Bold)
            Text(driver?.phone?.let(::formatDriverPhone) ?: "Teléfono no disponible", color = muted)
            HorizontalDivider(color = border)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Box(Modifier.size(9.dp).background(green, RoundedCornerShape(50)))
                Column {
                    Text("Sesión protegida", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                    Text("Este celular está vinculado a tu identidad.", color = muted, fontSize = 12.sp)
                }
            }
        }
    }
    OutlinedButton(
        enabled = !state.busy,
        onClick = model::logout,
        border = BorderStroke(1.dp, green),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = green),
    ) { Text("Cerrar sesión") }
}

@Composable
private fun OrderCard(order: DeliveryOrder, timezone: String, onClick: () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = panel), modifier = Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text("PARADA ${order.position}", color = green, fontWeight = FontWeight.Bold, fontSize = 10.sp)
            Text(order.customer, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Text("Pedido ${order.name}", color = muted, fontSize = 12.sp)
            Text(order.address, fontSize = 13.sp)
            order.eta?.let {
                Text("Llegada estimada: ${formatRouteTime(it, timezone)}", color = muted, fontSize = 12.sp)
            }
            if (!order.phone.isNullOrBlank()) Text("Teléfono: ${order.phone}", color = muted, fontSize = 12.sp)
            if (order.note.isNotBlank()) Text(order.note, color = muted, fontSize = 12.sp)
            HorizontalDivider(color = border)
            order.lines.forEach { line ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(line.name, modifier = Modifier.weight(1f), fontSize = 13.sp)
                    Text("${line.quantity} ${line.unit}", color = green, fontSize = 13.sp)
                }
            }
        }
    }
}

@Composable
private fun RouteStatusPill(status: String) {
    val color = when (status) {
        "current" -> green
        "stale" -> warning
        else -> muted
    }
    Surface(
        color = color.copy(alpha = 0.14f),
        shape = RoundedCornerShape(50),
        border = BorderStroke(1.dp, color.copy(alpha = 0.45f)),
    ) {
        Text(
            routeStatusLabel(status),
            color = color,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp),
            maxLines = 1,
        )
    }
}

@Composable
private fun ScreenHeading(title: String, subtitle: String?) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            title,
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.semantics { heading() },
        )
        if (!subtitle.isNullOrBlank()) Text(subtitle, color = muted, fontSize = 13.sp)
    }
}

@Composable
private fun SectionTitle(title: String) {
    Text(title, fontWeight = FontWeight.Bold, fontSize = 15.sp, modifier = Modifier.semantics { heading() })
}

@Composable
private fun EmptyState(title: String, detail: String) {
    Surface(
        color = panel,
        shape = RoundedCornerShape(15.dp),
        border = BorderStroke(1.dp, border),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(title, fontWeight = FontWeight.Bold)
            Text(detail, color = muted, fontSize = 13.sp)
        }
    }
}

private fun DriverUiState.activePlan(): AssignedPlan? = selected ?: dashboard?.today

private fun vehicleLabel(vehicle: String, plate: String): String =
    if (plate.isBlank()) vehicle else "$vehicle · $plate"
