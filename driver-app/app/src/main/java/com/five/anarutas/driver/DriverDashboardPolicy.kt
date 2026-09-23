package com.five.anarutas.driver

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

enum class DriverDestination { HOME, ROUTE, ORDERS, UNIT, HISTORY, PROFILE, SETTINGS }
enum class DashboardLoadState { LOADING, FAILED, READY }

internal fun dashboardLoadState(
    dashboard: DriverDashboard?,
    busy: Boolean,
): DashboardLoadState = when {
    dashboard != null -> DashboardLoadState.READY
    busy -> DashboardLoadState.LOADING
    else -> DashboardLoadState.FAILED
}

internal fun formatRouteDistance(meters: Int?): String = when {
    meters == null -> "Pendiente"
    meters < 1_000 -> "$meters m"
    else -> String.format(Locale.US, "%.1f km", meters / 1_000.0)
}

internal fun formatRouteDuration(seconds: Int?): String {
    if (seconds == null) return "Pendiente"
    val totalMinutes = seconds / 60
    val hours = totalMinutes / 60
    val minutes = totalMinutes % 60
    return when {
        hours == 0 -> "$minutes min"
        minutes == 0 -> "$hours h"
        else -> "$hours h $minutes min"
    }
}

internal fun formatRouteTime(value: String?, timezone: String): String {
    if (value.isNullOrBlank()) return "Pendiente"
    return runCatching {
        DateTimeFormatter.ofPattern("HH:mm")
            .withZone(ZoneId.of(timezone))
            .format(Instant.parse(value))
    }.getOrDefault("Pendiente")
}

internal fun formatServiceDate(value: String): String = runCatching {
    val locale = Locale.forLanguageTag("es-MX")
    val formatted = LocalDate.parse(value).format(
        DateTimeFormatter.ofPattern("EEEE d 'de' MMMM", locale),
    )
    formatted.replaceFirstChar { it.titlecase(locale) }
}.getOrDefault(value)

internal fun formatDriverPhone(value: String): String {
    val digits = value.filter(Char::isDigit).takeLast(10)
    return if (digits.length == 10) {
        "${digits.take(2)} ${digits.substring(2, 6)} ${digits.takeLast(4)}"
    } else value
}

internal fun routeStatusLabel(status: String): String = when (status) {
    "current" -> "Recorrido vigente"
    "stale" -> "Requiere actualización"
    "not_calculated" -> "Sin recorrido calculado"
    "empty" -> "Ruta sin pedidos"
    else -> "Estado no disponible"
}

internal fun otherPlans(dashboard: DriverDashboard): List<PlanSummary> =
    dashboard.plans.filter { it.id != dashboard.today?.id }

internal fun DriverUiState.activePlan(): AssignedPlan? = selected ?: dashboard?.today

internal fun DriverUiState.runningPlan(): AssignedPlan? =
    dashboard?.today?.takeIf { it.startedAt != null }

internal fun canPrepareRoute(route: AssignedPlan?, serviceDate: String?): Boolean =
    route != null && route.date == serviceDate && route.startedAt == null

internal fun canStartRoute(route: AssignedPlan?, serviceDate: String?): Boolean =
    canPrepareRoute(route, serviceDate) && route!!.photoCount >= 5 &&
        route.orders.isNotEmpty() && route.routeStatus == "current"

internal fun filterDriverOrders(orders: List<DeliveryOrder>, query: String): List<DeliveryOrder> {
    val term = query.trim()
    if (term.isEmpty()) return orders
    return orders.filter { order ->
        listOf(order.customer, order.name, order.address).any { it.contains(term, ignoreCase = true) }
    }
}

internal fun vehicleLabel(vehicle: String, plate: String): String =
    if (plate.isBlank()) vehicle else "$vehicle · $plate"
