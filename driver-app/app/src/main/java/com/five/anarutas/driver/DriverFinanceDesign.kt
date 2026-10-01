package com.five.anarutas.driver

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp

@Composable
internal fun FinanceRefreshButton(loading: Boolean, enabled: Boolean, onRefresh: () -> Unit) {
    IconButton(onClick = onRefresh, enabled = enabled && !loading, modifier = Modifier.size(48.dp).semantics {
        contentDescription = "Actualizar liquidación"
        stateDescription = if (loading) "Actualizando liquidación" else "Disponible"
    }) {
        if (loading) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = DriverColors.lime)
        else AppIcon(DriverIcon.REFRESH, Modifier.size(22.dp))
    }
}

@Composable
internal fun FinanceBackButton(enabled: Boolean, onBack: () -> Unit) {
    OutlinedButton(onClick = onBack, enabled = enabled, modifier = Modifier.heightIn(min = 48.dp),
        shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, DriverColors.lime.copy(alpha = .55f)),
        colors = ButtonDefaults.outlinedButtonColors(containerColor = DriverColors.background, contentColor = DriverColors.lime)) {
        Text("Volver a mis rutas")
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun CompactFinanceOrderCard(customer: String, orderName: String, status: String, method: String,
    amount: String, split: String?, enabled: Boolean, onOpen: () -> Unit, onLiquidate: (() -> Unit)?) {
    Surface(onClick = onOpen, modifier = Modifier.fillMaxWidth(), color = DriverColors.surface,
        shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp, DriverColors.line.copy(alpha = .6f))) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(customer, style = MaterialTheme.typography.titleSmall, color = DriverColors.ink)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(orderName, style = MaterialTheme.typography.bodySmall, color = DriverColors.lime)
                Text(status, style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
            }
            HorizontalDivider(color = DriverColors.line)
            Text(if (method == "credit") "Importe a crédito" else "Monto a entregar", style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(amount, style = MaterialTheme.typography.titleLarge, color = DriverColors.lime)
                Text(paymentMethodLabel(method), style = MaterialTheme.typography.bodyMedium)
            }
            if (split != null) Text(split, style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FinanceCardAction("Ver pedido y cobro", DriverIcon.ORDERS, Modifier.weight(1f), true, true, onOpen)
                if (onLiquidate != null) FinanceCardAction("Liquidar", DriverIcon.CHECK, Modifier.weight(1f), enabled, false, onLiquidate)
            }
        }
    }
}

@Composable
private fun FinanceCardAction(label: String, icon: DriverIcon, modifier: Modifier, enabled: Boolean, quiet: Boolean, onClick: () -> Unit) {
    Button(onClick = onClick, enabled = enabled, modifier = modifier.heightIn(min = 48.dp), shape = RoundedCornerShape(12.dp),
        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 8.dp),
        colors = ButtonDefaults.buttonColors(containerColor = if (quiet) DriverColors.raised else DriverColors.amber,
            contentColor = if (quiet) DriverColors.ink else DriverColors.limeInk)) {
        AppIcon(icon, Modifier.size(16.dp))
        Spacer(Modifier.width(6.dp))
        Text(label, style = MaterialTheme.typography.labelMedium)
    }
}
