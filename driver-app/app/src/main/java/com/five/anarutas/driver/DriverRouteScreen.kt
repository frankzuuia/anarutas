package com.five.anarutas.driver

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

internal fun LazyListScope.routeContent(state: DriverUiState, model: DriverViewModel, mapAvailable: Boolean, onMap: () -> Unit) {
    val route = state.activePlan()
    val timezone = state.dashboard?.timezone ?: "America/Mexico_City"
    item { ScreenTitle("Tu ruta", route?.let { "${it.date} · ${vehicleLabel(it.vehicle, it.plate)}" } ?: "Tu siguiente recorrido") }
    if (route == null) {
        item { EmptyPanel("Esperando tu ruta", "Cuando administración la publique, podrás revisar tus pedidos y preparar tu salida.") }
        return
    }
    item { RouteOverviewCard(route, timezone) }
    item { InspectionCard(route, state.busy, model::openPhotos) }
    item { RouteDeparture(state, route, model, mapAvailable, onMap) }
    if (route.orders.isNotEmpty()) item { SectionLabel("Secuencia de paradas", "${route.orders.size} pedidos") }
    items(route.orders, key = { it.id }) { order -> OrderRow(order, timezone, true) { model.showOrder(order.id) } }
}

@Composable
internal fun RouteOverviewCard(route: AssignedPlan, timezone: String) {
    AppCard {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            AppIcon(DriverIcon.ROUTE, tint = DriverColors.lime)
            Text(route.label, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
        }
        StatusBadge(if (route.startedAt != null) "Ruta iniciada" else routeStatusLabel(route.routeStatus), if (route.routeStatus == "current") DriverColors.lime else DriverColors.amber)
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                RouteMetric("Pedidos", route.orders.size.toString(), DriverIcon.ORDERS, Modifier.weight(1f))
                RouteMetric("Paradas", route.overview?.stopCount?.toString() ?: "Pendiente", DriverIcon.PIN, Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                RouteMetric("Distancia", formatRouteDistance(route.overview?.travelDistanceMeters), DriverIcon.ROUTE, Modifier.weight(1f))
                RouteMetric("Tiempo planeado", formatRouteDuration(route.overview?.totalDurationSeconds), DriverIcon.CLOCK, Modifier.weight(1f))
            }
        }
        HorizontalDivider(color = DriverColors.line)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            MiniMetric("SALIDA PLANEADA", formatRouteTime(route.overview?.departureAt, timezone))
            MiniMetric("REGRESO ESTIMADO", formatRouteTime(route.overview?.finishedAt, timezone))
        }
    }
}

@Composable
private fun RouteMetric(label: String, value: String, icon: DriverIcon, modifier: Modifier) {
    Surface(modifier, shape = RoundedCornerShape(14.dp), color = DriverColors.raised) {
        Column(Modifier.padding(13.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            AppIcon(icon, Modifier.size(16.dp), tint = DriverColors.muted)
            Text(value, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-.5).sp)
            Text(label, style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
        }
    }
}

@Composable
internal fun InspectionCard(route: AssignedPlan, busy: Boolean, onPhotos: () -> Unit) {
    Surface(onClick = onPhotos, enabled = !busy, shape = RoundedCornerShape(18.dp), color = DriverColors.surface, border = BorderStroke(1.dp, DriverColors.line)) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(42.dp).background(DriverColors.purple.copy(alpha = .10f), RoundedCornerShape(13.dp)), contentAlignment = Alignment.Center) {
                AppIcon(DriverIcon.CAMERA, tint = DriverColors.purple)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Fotos de la unidad", style = MaterialTheme.typography.titleMedium)
                Text("${route.photoCount} de 8 · ${if (route.startedAt != null) "Revisión cerrada" else "Mínimo 5 para salir"}", color = DriverColors.muted, style = MaterialTheme.typography.bodySmall)
            }
            AppIcon(DriverIcon.CHEVRON, Modifier.size(17.dp), tint = DriverColors.muted, description = "Ver fotos")
        }
    }
}

@Composable
private fun RouteDeparture(state: DriverUiState, route: AssignedPlan, model: DriverViewModel, mapAvailable: Boolean, onMap: () -> Unit) {
    var confirmStart by rememberSaveable(route.id, route.publicationRevision) { mutableStateOf(false) }
    val canStart = canStartRoute(route, state.dashboard?.serviceDate)
    val isToday = route.date == state.dashboard?.serviceDate
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        when {
            !isToday -> Text("Ruta de otra fecha · sólo consulta", style = MaterialTheme.typography.bodyMedium, color = DriverColors.amber)
            route.startedAt != null -> {
                if (mapAvailable) AppAction("Abrir mapa de ruta", DriverIcon.MAP, onClick = onMap)
                else Text("El mapa aún no está disponible. Avísale a administración.", style = MaterialTheme.typography.bodyMedium, color = DriverColors.muted)
            }
            else -> {
                AppAction("Iniciar ruta", DriverIcon.ARROW, enabled = canStart && !state.busy) { confirmStart = true }
                when {
                    route.photoCount < 5 -> Text("Faltan ${5 - route.photoCount} fotos de hoy para preparar tu salida.", color = DriverColors.muted, style = MaterialTheme.typography.bodySmall)
                    route.routeStatus != "current" -> Text(routeStatusMessage(route.routeStatus).orEmpty(), color = DriverColors.amber, style = MaterialTheme.typography.bodySmall)
                    else -> Text("Revisa tus pedidos antes de salir.", color = DriverColors.muted, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
    if (confirmStart && canStart) AlertDialog(
        onDismissRequest = { if (!state.busy) confirmStart = false },
        icon = { AppIcon(DriverIcon.ROUTE, Modifier.size(28.dp), tint = DriverColors.lime) },
        title = { Text("¿Listo para iniciar?") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(route.label, style = MaterialTheme.typography.titleMedium)
                Text("${route.overview?.stopCount ?: route.orders.size} paradas · ${route.orders.size} pedidos\n${vehicleLabel(route.vehicle, route.plate)}")
                Text("${formatRouteDistance(route.overview?.travelDistanceMeters)} · ${formatRouteDuration(route.overview?.totalDurationSeconds)} planeados")
                Text("Al confirmar, administración verá que iniciaste y las fotos quedarán cerradas.", style = MaterialTheme.typography.bodyMedium)
            }
        },
        confirmButton = { TextButton(enabled = !state.busy, onClick = { confirmStart = false; model.startRoute(route.id, route.publicationRevision) }) { Text("Sí, iniciar ruta") } },
        dismissButton = { TextButton(enabled = !state.busy, onClick = { confirmStart = false }) { Text("Todavía no") } },
    )
}

@Composable
internal fun OrderRow(order: DeliveryOrder, timezone: String, showTime: Boolean, onClick: () -> Unit) {
    Surface(onClick = onClick, shape = RoundedCornerShape(16.dp), color = DriverColors.surface, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(34.dp).background(DriverColors.lime.copy(alpha = .10f), RoundedCornerShape(11.dp)), contentAlignment = Alignment.Center) {
                Text(order.position.toString(), color = DriverColors.lime, style = MaterialTheme.typography.titleMedium)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(order.customer, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(if (showTime) order.address else "${order.name} · ${order.lines.size} partidas", color = DriverColors.muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (showTime && order.eta != null) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    AppIcon(DriverIcon.CLOCK, Modifier.size(12.dp), tint = DriverColors.muted)
                    Text("${formatRouteTime(order.eta, timezone)} estimada · ${order.name}", style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
                }
            }
            AppIcon(DriverIcon.CHEVRON, Modifier.size(15.dp), tint = DriverColors.muted)
        }
    }
}
