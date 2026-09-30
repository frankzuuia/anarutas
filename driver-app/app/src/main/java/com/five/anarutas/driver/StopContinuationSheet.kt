package com.five.anarutas.driver

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

@Composable
internal fun StopContinuationSheet(completion: StopCompletion, next: ExecutionStop?, canNavigate: Boolean,
    onNext: () -> Unit, onClose: () -> Unit, warehouse: WarehouseDestination? = null,
    canReturn: Boolean = false, onWarehouse: () -> Unit = {}) {
    DetailSurface(onClose) {
        Text(when (completion) { StopCompletion.CUSTOMER_CLOSED -> "Cliente cerrado registrado"; StopCompletion.RESCHEDULED -> "Reprogramación confirmada"; else -> "Entrega confirmada" },
            style = MaterialTheme.typography.titleLarge)
        Text(if (completion == StopCompletion.CUSTOMER_CLOSED)
            "La incidencia quedó guardada. Esta parada sigue pendiente de reintento."
            else if (completion == StopCompletion.RESCHEDULED) "El pedido quedó reprogramado, no entregado. Puedes continuar tu recorrido."
            else "La entrega quedó guardada. Puedes continuar tu recorrido.", color = DriverColors.muted)
        if (next != null) {
            SectionLabel("SIGUIENTE PARADA", next.position.toString())
            Text(next.customer, style = MaterialTheme.typography.titleMedium)
            Text(next.address, style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
            if (next.hasPendingRetry()) Text("Esta parada tiene un reintento pendiente.", color = DriverColors.amber)
            AppAction("Ir a la siguiente parada", DriverIcon.ROUTE, Modifier.fillMaxWidth(), enabled = canNavigate, onClick = onNext)
            if (!canNavigate) Text("La guía aún no está disponible. Puedes cerrar y continuar manualmente cuando se recupere la conexión y la ubicación.",
                style = MaterialTheme.typography.bodySmall, color = DriverColors.amber)
        } else if (warehouse != null && completion != StopCompletion.CUSTOMER_CLOSED) {
            SectionLabel("REGRESO A BODEGA", "Sin pendientes")
            Text("Todos los pedidos están entregados o reprogramados. No tienes reintentos pendientes.", color = DriverColors.lime)
            Text(warehouse.departure.address, style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
            AppAction("Ir a bodega", DriverIcon.ROUTE, Modifier.fillMaxWidth(), enabled = canReturn, onClick = onWarehouse)
            if (!canReturn) Text("Esperando conexión y disponibilidad de la guía. El regreso también estará disponible en el mapa.",
                style = MaterialTheme.typography.bodySmall, color = DriverColors.amber)
            Text("La guía te lleva al punto de salida. No cierra ni liquida la ruta.",
                style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
        } else Text("No hay otra parada pendiente con ubicación disponible. Puedes revisar tus paradas manualmente; la ruta no se cierra ni se liquida aquí.",
            color = DriverColors.muted, style = MaterialTheme.typography.bodySmall)
        AppAction("Cerrar", DriverIcon.CLOSE, Modifier.fillMaxWidth(), quiet = true, onClick = onClose)
    }
}
