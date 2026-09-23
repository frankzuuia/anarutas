package com.five.anarutas.driver

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun AccessScreen(state: DriverUiState, model: DriverViewModel) {
    var confirmReset by rememberSaveable { mutableStateOf(false) }
    Column(
        Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(28.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        Wordmark()
        Spacer(Modifier.height(24.dp))
        StatusBadge("ESPACIO DEL CHOFER")
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Tu jornada,\nbien encaminada.", style = MaterialTheme.typography.headlineLarge)
            Text("Ingresa con el teléfono y PIN que te dio administración.", style = MaterialTheme.typography.bodyLarge, color = DriverColors.muted)
        }
        AppCard {
            OutlinedTextField(
                value = state.phone, onValueChange = model::updatePhone, label = { Text("Teléfono") },
                leadingIcon = { AppIcon(DriverIcon.PHONE, tint = DriverColors.muted) },
                modifier = Modifier.fillMaxWidth(), singleLine = true, enabled = !state.busy,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = ImeAction.Next),
            )
            OutlinedTextField(
                value = state.pin, onValueChange = model::updatePin, label = { Text("PIN de 4 dígitos") },
                leadingIcon = { AppIcon(DriverIcon.LOCK, tint = DriverColors.muted) },
                modifier = Modifier.fillMaxWidth(), singleLine = true, enabled = !state.busy,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { model.submitAccess() }),
            )
            StatusMessages(state)
            AppAction(if (state.busy) "Conectando…" else "Entrar", DriverIcon.ARROW, Modifier.fillMaxWidth(), enabled = !state.busy, onClick = model::submitAccess)
            if (state.deviceId.isNotBlank()) TextButton(onClick = { confirmReset = true }, enabled = !state.busy) { Text("Reactivar este dispositivo") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
            AppIcon(DriverIcon.SHIELD, Modifier.size(17.dp), tint = DriverColors.muted)
            Text("Acceso personal y seguro. No compartas tu PIN.", style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
        }
    }
    if (confirmReset) AlertDialog(
        onDismissRequest = { confirmReset = false }, title = { Text("¿Reactivar el acceso?") },
        text = { Text("Se quitará la vinculación guardada en este celular. Podrás ingresar de nuevo con tu teléfono y PIN.") },
        confirmButton = { TextButton(onClick = { confirmReset = false; model.reactivateDevice() }) { Text("Reactivar") } },
        dismissButton = { TextButton(onClick = { confirmReset = false }) { Text("Volver") } },
    )
}

@Composable
internal fun DashboardScreen(state: DriverUiState, model: DriverViewModel) {
    val dashboard = state.dashboard
    if (dashboard == null) {
        EmptyPanel(if (state.busy) "Preparando tu jornada" else "No pudimos cargar el inicio", "${if (state.busy) "Estamos consultando tu información." else "Revisa tu conexión e inténtalo de nuevo."}")
        if (!state.busy) AppAction("Reintentar", DriverIcon.REFRESH, onClick = model::refreshDashboard)
        return
    }
    val route = dashboard.today
    Column(verticalArrangement = Arrangement.spacedBy(24.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text("Hola, ${dashboard.driver.name.trim().substringBefore(' ')}", style = MaterialTheme.typography.headlineLarge)
                Text(formatServiceDate(dashboard.serviceDate), color = DriverColors.muted, style = MaterialTheme.typography.bodyMedium)
            }
            DriverAvatar(dashboard.driver.name)
        }
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SectionLabel("Tu espacio")
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                HomeTile("Ruta activa", when { route == null -> "Por asignar"; route.startedAt != null -> "En recorrido"; else -> "Lista para preparar" }, DriverIcon.ROUTE, DriverColors.lime, Modifier.weight(1f), true) { model.navigate(DriverDestination.ROUTE) }
                HomeTile("Pedidos", "${route?.orders?.size ?: 0} asignados hoy", DriverIcon.ORDERS, DriverColors.blue, Modifier.weight(1f)) { model.navigate(DriverDestination.ORDERS) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                HomeTile("Mi unidad", route?.vehicle ?: "Sin ruta asignada", DriverIcon.TRUCK, DriverColors.purple, Modifier.weight(1f)) { model.navigate(DriverDestination.UNIT) }
                HomeTile("Mis rutas", "${dashboard.plans.size} publicadas", DriverIcon.HISTORY, DriverColors.amber, Modifier.weight(1f)) { model.navigate(DriverDestination.HISTORY) }
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SectionLabel("Hoy", "${route?.date ?: dashboard.serviceDate}")
            if (route == null) EmptyPanel("Aún no tienes una ruta", "Cuando administración la publique, aparecerá aquí. Tu información se actualiza automáticamente.")
            else Surface(onClick = { model.navigate(DriverDestination.ROUTE) }, color = DriverColors.surface, shape = RoundedCornerShape(20.dp), border = BorderStroke(1.dp, DriverColors.line)) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(15.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        AppIcon(DriverIcon.ROUTE, tint = DriverColors.lime)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(route.label, style = MaterialTheme.typography.titleMedium)
                            Text(vehicleLabel(route.vehicle, route.plate), style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
                        }
                        AppIcon(DriverIcon.ARROW, Modifier.size(19.dp))
                    }
                    HorizontalDivider(color = DriverColors.line)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        MiniMetric("PARADAS", route.overview?.stopCount?.toString() ?: "Pendiente")
                        MiniMetric("DISTANCIA", formatRouteDistance(route.overview?.travelDistanceMeters))
                        MiniMetric("TIEMPO", formatRouteDuration(route.overview?.totalDurationSeconds))
                    }
                    StatusBadge(when { route.startedAt != null -> "Ruta iniciada"; route.photoCount >= 5 -> "Revisión de salida lista"; else -> "${route.photoCount} de 5 fotos para salir" }, if (route.startedAt != null || route.photoCount >= 5) DriverColors.lime else DriverColors.amber)
                }
            }
        }
    }
}

@Composable
internal fun HomeTile(title: String, subtitle: String, icon: DriverIcon, accent: Color, modifier: Modifier = Modifier, featured: Boolean = false, onClick: () -> Unit) {
    val ink = if (featured) DriverColors.limeInk else DriverColors.ink
    Surface(onClick = onClick, modifier = modifier, shape = RoundedCornerShape(22.dp), color = if (featured) accent else DriverColors.surface) {
        Column(Modifier.heightIn(min = 152.dp).padding(17.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                AppIcon(icon, Modifier.size(27.dp), tint = if (featured) ink else accent)
                AppIcon(DriverIcon.NORTH_EAST, Modifier.size(16.dp), tint = ink.copy(alpha = .55f))
            }
            Column(Modifier.padding(top = 22.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(title, color = ink, style = MaterialTheme.typography.titleMedium)
                Text(subtitle, color = ink.copy(alpha = .70f), style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
internal fun MiniMetric(label: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = DriverColors.muted)
        Text(value, style = MaterialTheme.typography.titleMedium)
    }
}

internal fun LazyListScope.ordersContent(state: DriverUiState, model: DriverViewModel, query: String, onQuery: (String) -> Unit) {
    val route = state.activePlan()
    val orders = filterDriverOrders(route?.orders.orEmpty(), query)
    item { ScreenTitle("Pedidos", route?.let { "${it.orders.size} pedidos · ${it.date}" } ?: "Tu lista de entregas") }
        if (route == null || route.orders.isEmpty()) item { EmptyPanel("Sin pedidos asignados", "Aquí podrás consultar el detalle de cada pedido publicado en tu ruta.", DriverIcon.ORDERS) }
        else {
            item { OutlinedTextField(query, onQuery, Modifier.fillMaxWidth(), singleLine = true,
                placeholder = { Text("Cliente, folio o dirección", style = MaterialTheme.typography.bodyMedium) },
                leadingIcon = { AppIcon(DriverIcon.SEARCH, tint = DriverColors.muted) },
                trailingIcon = { if (query.isNotEmpty()) AppIconButton(DriverIcon.CLOSE, "Limpiar búsqueda") { onQuery("") } },
                shape = RoundedCornerShape(16.dp), keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search)) }
            if (orders.isEmpty()) item { EmptyPanel("Sin coincidencias", "Prueba con otro cliente, folio o dirección.", DriverIcon.SEARCH) }
            items(orders, key = { it.id }) { order -> OrderRow(order, state.dashboard?.timezone ?: "America/Mexico_City", false) { model.showOrder(order.id) } }
        }
}

@Composable
internal fun UnitScreen(state: DriverUiState, model: DriverViewModel) {
    val route = state.activePlan()
    Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
        ScreenTitle("Mi unidad", "Revisión de salida")
        if (route == null) EmptyPanel("Sin unidad en tu ruta", "La unidad asignada aparecerá cuando administración publique tu ruta.", DriverIcon.TRUCK)
        else {
            AppCard {
                AppIcon(DriverIcon.TRUCK, Modifier.size(36.dp), tint = DriverColors.purple)
                Text(route.vehicle, style = MaterialTheme.typography.titleLarge)
                Text(route.plate.ifBlank { "Sin placa registrada" }, style = MaterialTheme.typography.bodyLarge, color = DriverColors.muted)
                HorizontalDivider(color = DriverColors.line)
                Text("${route.label} · ${route.date}", style = MaterialTheme.typography.bodyMedium)
            }
            InspectionCard(route, state.busy, model::openPhotos)
            Text(if (canPrepareRoute(route, state.dashboard?.serviceDate)) "Captura el exterior, placas, llantas y estado general de la unidad antes de salir." else "Puedes consultar las fotos registradas para esta ruta.", style = MaterialTheme.typography.bodyMedium, color = DriverColors.muted)
        }
    }
}

internal fun LazyListScope.historyContent(state: DriverUiState, model: DriverViewModel) {
    val plans = state.dashboard?.plans.orEmpty()
    item { ScreenTitle("Mis rutas", "Rutas publicadas para ti") }
    if (plans.isEmpty()) item { EmptyPanel("Todavía no hay rutas", "Tus rutas publicadas se mostrarán aquí, con sus pedidos y recorridos.", DriverIcon.HISTORY) }
    items(plans, key = { it.id }) { plan ->
        ActionRow(DriverIcon.ROUTE, plan.label, "${plan.date} · ${plan.vehicle} · ${plan.orderCount} pedidos") { if (!state.busy) model.selectPlan(plan.id) }
    }
}

@Composable
internal fun ProfileScreen(state: DriverUiState, model: DriverViewModel) {
    var confirmLogout by rememberSaveable { mutableStateOf(false) }
    val driver = state.dashboard?.driver
    Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
        ScreenTitle("Mi perfil", "Tu cuenta de trabajo")
        AppCard {
            DriverAvatar(driver?.name.orEmpty())
            Text(driver?.name ?: "Chofer", style = MaterialTheme.typography.titleLarge)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                AppIcon(DriverIcon.PHONE, Modifier.size(18.dp), tint = DriverColors.muted)
                Text(formatDriverPhone(driver?.phone ?: state.phone), style = MaterialTheme.typography.bodyLarge, color = DriverColors.muted)
            }
            Text("Para cambiar tus datos, contacta a administración.", style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
        }
        ActionRow(DriverIcon.SETTINGS, "Preferencias", "Pantalla y permisos del dispositivo") { model.navigate(DriverDestination.SETTINGS) }
        AppAction("Cerrar sesión", DriverIcon.LOGOUT, quiet = true, enabled = !state.busy) { confirmLogout = true }
        Text("Five Rutas · ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
    }
    if (confirmLogout) AlertDialog(onDismissRequest = { confirmLogout = false }, title = { Text("¿Cerrar tu sesión?") }, text = { Text("Se cerrará el acceso a tu cuenta en este celular. Tu ruta y tus fotos seguirán guardadas.") },
        confirmButton = { TextButton(onClick = { confirmLogout = false; model.logout() }, enabled = !state.busy) { Text("Cerrar sesión") } },
        dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text("Seguir aquí") } })
}

@Composable
internal fun PreferencesScreen(keepAwake: Boolean, onKeepAwake: (Boolean) -> Unit) {
    val context = LocalContext.current
    Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
        ScreenTitle("Preferencias", "A tu manera, en este celular")
        AppCard {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                AppIcon(DriverIcon.SUN, tint = DriverColors.amber)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Mantener pantalla activa", style = MaterialTheme.typography.titleMedium)
                    Text("Sólo con la app abierta y una ruta iniciada. Consume más batería.", style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
                }
                Switch(checked = keepAwake, onCheckedChange = onKeepAwake, modifier = Modifier.heightIn(min = 48.dp).semantics { contentDescription = "Mantener pantalla activa durante la ruta" })
            }
        }
        ActionRow(DriverIcon.SHIELD, "Permisos de la app", "Revisa ubicación y otros permisos en Android") {
            context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)))
        }
    }
}
