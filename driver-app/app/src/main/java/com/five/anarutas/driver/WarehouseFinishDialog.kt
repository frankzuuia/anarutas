package com.five.anarutas.driver

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
internal fun WarehouseFinishDialog(address: String, canConfirm: Boolean, busy: Boolean, onConfirm: () -> Unit, onCancel: () -> Unit) {
    AlertDialog(
        onDismissRequest = { if (!busy) onCancel() },
        icon = { AppIcon(DriverIcon.CHECK, Modifier.size(28.dp), tint = DriverColors.lime) },
        title = { Text("¿Estás seguro de que terminaste tu ruta?") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(address, style = MaterialTheme.typography.titleMedium)
            Text("Se confirmará tu regreso a bodega con tu ubicación actual. Los pedidos reprogramados y las incidencias se conservan; esto no liquida la ruta.")
            if (!canConfirm) Text("Espera conexión y GPS reciente y preciso dentro del radio de bodega.", color = DriverColors.amber)
        } },
        confirmButton = { TextButton(enabled = canConfirm && !busy, onClick = onConfirm) { Text("Aceptar") } },
        dismissButton = { TextButton(enabled = !busy, onClick = onCancel) { Text("Cancelar") } },
    )
}
