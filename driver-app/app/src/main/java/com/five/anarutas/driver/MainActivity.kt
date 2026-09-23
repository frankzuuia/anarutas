package com.five.anarutas.driver

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        val credentials = DeviceCredentials(applicationContext)
        setContent {
            val model: DriverViewModel = viewModel(factory = DriverViewModel.factory(credentials))
            DriverTheme {
                Surface(Modifier.fillMaxSize(), color = DriverColors.background) {
                    when {
                        model.state.initializing -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(24.dp)) {
                                Wordmark()
                                CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                            }
                        }
                        model.state.token.isBlank() -> AccessScreen(model.state, model)
                        else -> DriverShell(model.state, model)
                    }
                }
            }
        }
    }
}

internal val DriverDestination.title: String get() = when (this) {
    DriverDestination.HOME -> "Inicio"
    DriverDestination.ROUTE -> "Ruta"
    DriverDestination.ORDERS -> "Pedidos"
    DriverDestination.UNIT -> "Mi unidad"
    DriverDestination.HISTORY -> "Mis rutas"
    DriverDestination.PROFILE -> "Mi perfil"
    DriverDestination.SETTINGS -> "Preferencias"
}

internal val DriverDestination.icon: DriverIcon get() = when (this) {
    DriverDestination.HOME -> DriverIcon.HOME
    DriverDestination.ROUTE -> DriverIcon.ROUTE
    DriverDestination.ORDERS -> DriverIcon.ORDERS
    DriverDestination.UNIT -> DriverIcon.TRUCK
    DriverDestination.HISTORY -> DriverIcon.HISTORY
    DriverDestination.PROFILE -> DriverIcon.PROFILE
    DriverDestination.SETTINGS -> DriverIcon.SETTINGS
}

@Composable
private fun DriverShell(state: DriverUiState, model: DriverViewModel) {
    val context = LocalContext.current
    val view = LocalView.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val preferences = remember { DriverPreferences(context.applicationContext) }
    var keepAwake by remember { mutableStateOf(preferences.keepRouteAwake) }
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val running = state.runningPlan()
    var orderQuery by rememberSaveable(state.activePlan()?.id) { mutableStateOf("") }
    val mapAvailable = running != null && BuildConfig.NAVIGATION_API_KEY.isNotBlank()
    val openMap: () -> Unit = {
        if (mapAvailable) context.startActivity(Intent(context, RouteNavigationActivity::class.java).putExtra(RouteNavigationActivity.EXTRA_PLAN_ID, running.id))
    }

    DisposableEffect(view, running?.id, keepAwake) {
        val previous = view.keepScreenOn
        view.keepScreenOn = keepAwake && running != null
        onDispose { view.keepScreenOn = previous }
    }
    LaunchedEffect(lifecycle, state.token) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            model.syncDashboard()
            launch {
                val token = state.token
                val api = DriverApi(BuildConfig.SERVER_URL)
                var retryMillis = 2000L
                while (isActive && token.isNotBlank()) {
                    try {
                        api.observeEvents(token) { event ->
                            when (event) {
                                "reset", "change", "session-expired" -> withContext(Dispatchers.Main) {
                                    model.requestDashboardRefresh()
                                }
                            }
                        }
                        retryMillis = 2000L
                    } catch (cancelled: kotlinx.coroutines.CancellationException) {
                        throw cancelled
                    } catch (_: Exception) {
                        // The periodic dashboard fetch remains the recovery path.
                    }
                    delay(retryMillis)
                    retryMillis = (retryMillis * 2).coerceAtMost(30000L)
                }
            }
            while (true) {
                delay(30_000)
                model.syncDashboard()
            }
        }
    }
    BackHandler(enabled = drawer.isOpen || state.destination != DriverDestination.HOME) {
        if (drawer.isOpen) scope.launch { drawer.close() } else model.navigate(DriverDestination.HOME)
    }

    ModalNavigationDrawer(
        drawerState = drawer,
        gesturesEnabled = !state.showPhotos && state.orderDetailId == null,
        scrimColor = Color.Black.copy(alpha = .65f),
        drawerContent = {
            ModalDrawerSheet(
                modifier = Modifier.widthIn(max = 320.dp), drawerContainerColor = DriverColors.background,
                drawerShape = RoundedCornerShape(topEnd = 28.dp, bottomEnd = 28.dp),
            ) {
                Column(Modifier.fillMaxHeight().padding(horizontal = 20.dp, vertical = 12.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Wordmark()
                        Spacer(Modifier.weight(1f))
                        AppIconButton(DriverIcon.CLOSE, "Cerrar menú") { scope.launch { drawer.close() } }
                    }
                    Row(Modifier.padding(vertical = 20.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        DriverAvatar(state.dashboard?.driver?.name.orEmpty())
                        Column {
                            Text(state.dashboard?.driver?.name ?: "Mi cuenta", style = MaterialTheme.typography.titleMedium)
                            Text("Tu espacio de trabajo", style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
                        }
                    }
                    HorizontalDivider(color = DriverColors.line)
                    Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(top = 18.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text("MI JORNADA", style = MaterialTheme.typography.labelSmall, color = DriverColors.muted, modifier = Modifier.padding(12.dp))
                        DriverDestination.entries.forEach { destination ->
                            NavigationDrawerItem(
                                label = { Text(destination.title, style = MaterialTheme.typography.titleMedium) },
                                icon = { AppIcon(destination.icon, tint = if (state.destination == destination) DriverColors.lime else DriverColors.muted) },
                                selected = state.destination == destination,
                                shape = RoundedCornerShape(13.dp),
                                colors = NavigationDrawerItemDefaults.colors(
                                    selectedContainerColor = DriverColors.lime.copy(alpha = .10f),
                                    unselectedContainerColor = Color.Transparent,
                                    selectedTextColor = DriverColors.lime, unselectedTextColor = DriverColors.ink,
                                ),
                                onClick = { model.navigate(destination); scope.launch { drawer.close() } },
                            )
                        }
                    }
                    HorizontalDivider(color = DriverColors.line)
                    Text("FIVE FINE VEGETABLES", style = MaterialTheme.typography.labelSmall, color = DriverColors.muted, modifier = Modifier.padding(top = 18.dp))
                    Text("Versión ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall, color = DriverColors.muted, modifier = Modifier.padding(top = 5.dp, bottom = 8.dp))
                }
            }
        },
    ) {
        Scaffold(
            containerColor = DriverColors.background,
            topBar = {
                Surface(color = DriverColors.background) {
                    Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 12.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        AppIconButton(DriverIcon.MENU, "Abrir menú") { scope.launch { drawer.open() } }
                        Spacer(Modifier.width(6.dp))
                        Wordmark()
                        Spacer(Modifier.weight(1f))
                        AppIconButton(DriverIcon.REFRESH, "Actualizar datos", enabled = !state.busy) { model.syncDashboard(manual = true) }
                    }
                }
            },
            bottomBar = { DriverBottomBar(state.destination, mapAvailable, model::navigate, openMap) },
        ) { padding ->
            key(state.destination, state.activePlan()?.id) {
                LazyColumn(
                    Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(18.dp),
                ) {
                    if (state.error.isNotBlank() || state.notice.isNotBlank()) item { StatusMessages(state) }
                    if (state.busy) item { LinearProgressIndicator(Modifier.fillMaxWidth().height(2.dp), color = DriverColors.lime, trackColor = DriverColors.raised) }
                    when (state.destination) {
                        DriverDestination.HOME -> item { DashboardScreen(state, model) }
                        DriverDestination.ROUTE -> routeContent(state, model, mapAvailable, openMap)
                        DriverDestination.ORDERS -> ordersContent(state, model, orderQuery) { orderQuery = it }
                        DriverDestination.UNIT -> item { UnitScreen(state, model) }
                        DriverDestination.HISTORY -> historyContent(state, model)
                        DriverDestination.PROFILE -> item { ProfileScreen(state, model) }
                        DriverDestination.SETTINGS -> item { PreferencesScreen(keepAwake) { keepAwake = it; preferences.keepRouteAwake = it } }
                    }
                }
            }
        }
    }
    if (state.showPhotos) UnitPhotosDialog(state, model)
    state.activePlan()?.orders?.firstOrNull { it.id == state.orderDetailId }?.let { order ->
        OrderDetailDialog(order, state.dashboard?.timezone ?: "America/Mexico_City", model::closeOrder)
    }
}

@Composable
internal fun StatusMessages(state: DriverUiState) {
    val text = state.error.ifBlank { state.notice }
    if (text.isBlank()) return
    val color = if (state.error.isNotBlank()) DriverColors.red else DriverColors.lime
    Surface(color = color.copy(alpha = .09f), shape = RoundedCornerShape(14.dp)) {
        Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            AppIcon(if (state.error.isNotBlank()) DriverIcon.INFO else DriverIcon.CHECK, Modifier.size(18.dp), tint = color)
            Text(text, color = color, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun DriverBottomBar(destination: DriverDestination, mapAvailable: Boolean, onNavigate: (DriverDestination) -> Unit, onMap: () -> Unit) {
    Surface(color = DriverColors.background, shadowElevation = 8.dp) {
        Column {
            HorizontalDivider(color = DriverColors.line.copy(alpha = .6f))
            Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 14.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                listOf(DriverDestination.HOME, DriverDestination.ROUTE, DriverDestination.ORDERS, DriverDestination.PROFILE).forEachIndexed { index, tab ->
                    if (index == 2 && mapAvailable) Surface(onClick = onMap, color = DriverColors.lime, shape = RoundedCornerShape(17.dp), modifier = Modifier.size(50.dp)) {
                        Box(contentAlignment = Alignment.Center) { AppIcon(DriverIcon.MAP, tint = DriverColors.limeInk, description = "Abrir mapa de ruta") }
                    }
                    val active = destination == tab
                    Surface(
                        onClick = { onNavigate(tab) }, color = if (active) DriverColors.raised else Color.Transparent,
                        shape = RoundedCornerShape(14.dp), modifier = Modifier.weight(1f).heightIn(min = 52.dp).semantics { role = Role.Tab; selected = active },
                    ) {
                        Column(Modifier.padding(vertical = 7.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            AppIcon(tab.icon, Modifier.size(20.dp), tint = if (active) DriverColors.lime else DriverColors.muted)
                            Text(if (tab == DriverDestination.PROFILE) "Perfil" else tab.title, style = MaterialTheme.typography.labelSmall, color = if (active) DriverColors.lime else DriverColors.muted)
                        }
                    }
                }
            }
        }
    }
}
