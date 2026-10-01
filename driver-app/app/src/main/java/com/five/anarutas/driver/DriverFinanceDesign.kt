package com.five.anarutas.driver

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun DriverShellBackHandler(drawerOpen: Boolean, destination: DriverDestination, financeExecutionId: String?,
    onCloseDrawer: () -> Unit, onFinanceRoutes: () -> Unit, onHome: () -> Unit) {
    BackHandler(enabled = drawerOpen || destination != DriverDestination.HOME) {
        when (driverBackTarget(drawerOpen, destination, financeExecutionId)) {
            DriverBackTarget.DRAWER -> onCloseDrawer()
            DriverBackTarget.FINANCE_ROUTES -> onFinanceRoutes()
            DriverBackTarget.HOME -> onHome()
        }
    }
}

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
internal fun FinanceBackButton(enabled: Boolean, modifier: Modifier = Modifier, onBack: () -> Unit) {
    OutlinedButton(onClick = onBack, enabled = enabled, modifier = modifier.heightIn(min = 48.dp),
        shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, DriverColors.lime.copy(alpha = .55f)),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
        colors = ButtonDefaults.outlinedButtonColors(containerColor = DriverColors.background, contentColor = DriverColors.lime)) {
        Text("Volver a mis rutas", style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
internal fun FinanceRouteHeader(label: String, date: String, enabled: Boolean, onBack: () -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(label, style = MaterialTheme.typography.titleMedium)
            Text(date, style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
        }
        FinanceBackButton(enabled, Modifier.widthIn(max = 148.dp), onBack)
    }
}

@Composable
internal fun FinanceMethodTiles(cash: String, transfer: String, credit: String, currency: DriverCurrency) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val tileWidth = ((maxWidth - 16.dp) / 3).coerceAtLeast(0.dp)
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(Triple("💵", "Efectivo", cash), Triple("🏦", "Transferencias", transfer), Triple("🗓️", "Crédito", credit)).forEachIndexed { index, (emoji, label, value) ->
                val accent = listOf(DriverColors.lime, DriverColors.blue, DriverColors.purple)[index]
                Surface(color = accent.copy(alpha = .06f), shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, accent.copy(alpha = .22f)),
                    modifier = Modifier.weight(1f).heightIn(min = tileWidth).fillMaxHeight().semantics(mergeDescendants = true) {}) {
                    Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(emoji, fontSize = 20.sp)
                        Text(label, color = accent, style = MaterialTheme.typography.labelSmall)
                        Text(financialMoney(value, currency).removeSuffix(" ${currency.name}"), color = accent, style = MaterialTheme.typography.titleSmall)
                        Text(currency.name, color = accent.copy(alpha = .8f), style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
    }
}

@Composable
internal fun FinanceRequestSurface(title: String, enabled: Boolean, dismissEnabled: Boolean,
    onAccept: () -> Unit, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    ServiceFormSurface(onDismiss = { if (dismissEnabled) onDismiss() }, header = {
        Text(title, style = MaterialTheme.typography.titleLarge)
    }, footer = {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AppAction("Cancelar", DriverIcon.CLOSE, Modifier.weight(1f), quiet = true, enabled = dismissEnabled, onClick = onDismiss)
            AppAction("Aceptar", DriverIcon.CHECK, Modifier.weight(1f), enabled = enabled, accent = DriverColors.amber, onClick = onAccept)
        }
    }, content = content)
}

@Composable
internal fun FinanceWorkSummary(deliveredOrders: Int, incidents: Int, totals: List<Pair<DriverCurrency, String>>) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        listOf("Pedidos entregados" to deliveredOrders, "Incidencias" to incidents).forEach { (label, count) ->
            Surface(Modifier.weight(1f), color = DriverColors.surface, shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, DriverColors.line)) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(label, style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
                    Text(count.toString(), style = MaterialTheme.typography.headlineSmall)
                }
            }
        }
    }
    Text("Monto total de la ruta", style = MaterialTheme.typography.titleSmall)
    totals.forEach { (currency, amount) -> Text(financialMoney(amount, currency), style = MaterialTheme.typography.headlineSmall, color = DriverColors.lime) }
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
