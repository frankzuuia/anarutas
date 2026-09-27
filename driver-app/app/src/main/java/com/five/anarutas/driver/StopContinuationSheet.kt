package com.five.anarutas.driver

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

@Composable
internal fun StopContinuationSheet(completion: StopCompletion, next: ExecutionStop?, canNavigate: Boolean,
    onNext: () -> Unit, onClose: () -> Unit) {
    DetailSurface(onClose) {
        Text(if (completion == StopCompletion.CUSTOMER_CLOSED) "Cliente cerrado registrado" else "Entrega confirmada",
            style = MaterialTheme.typography.titleLarge)
        Text(if (completion == StopCompletion.CUSTOMER_CLOSED)
            "La incidencia quedó guardada. Esta parada sigue pendiente de reintento."
            else "La entrega quedó guardada. Puedes continuar tu recorrido.", color = DriverColors.muted)
        if (next != null) {
            SectionLabel("SIGUIENTE PARADA", next.position.toString())
            Text(next.customer, style = MaterialTheme.typography.titleMedium)
            Text(next.address, style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
            if (next.hasPendingRetry()) Text("Esta parada tiene un reintento pendiente.", color = DriverColors.amber)
            AppAction("Ir a la siguiente parada", DriverIcon.ROUTE, Modifier.fillMaxWidth(), enabled = canNavigate, onClick = onNext)
            if (!canNavigate) Text("La guía aún no está disponible. Puedes cerrar y continuar manualmente cuando se recupere la conexión y la ubicación.",
                style = MaterialTheme.typography.bodySmall, color = DriverColors.amber)
        } else Text("No hay otra parada pendiente con ubicación disponible. Puedes revisar tus paradas manualmente; la ruta no se cierra ni se liquida aquí.",
            color = DriverColors.muted, style = MaterialTheme.typography.bodySmall)
        AppAction("Cerrar", DriverIcon.CLOSE, Modifier.fillMaxWidth(), quiet = true, onClick = onClose)
    }
}
