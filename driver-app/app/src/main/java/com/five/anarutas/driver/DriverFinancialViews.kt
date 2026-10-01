package com.five.anarutas.driver

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

@Composable
internal fun financialClock(): Long {
    val now by produceState(System.nanoTime()) {
        while (true) { delay(1000); value = System.nanoTime() }
    }
    return now
}
@Composable
internal fun FinancialLineDetails(line: DriverFinancialLine?, currency: DriverCurrency?) {
    if (line == null) return
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Precio unitario · ${financialMoney(line.unitPrice, currency)} / ${line.unit}",
            style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
        if (line.discount.toBigDecimal().signum() != 0) Text("Descuento del pedido · ${productQuantityText(line.discount)}%",
            style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
        Text("Importe original · ${financialMoney(line.total, currency)}", style = MaterialTheme.typography.bodySmall)
        if (line.net != null && line.net.toBigDecimal().compareTo(line.total.toBigDecimal()) != 0)
            Text("Importe actual · ${financialMoney(line.net, currency)}", style = MaterialTheme.typography.labelLarge, color = DriverColors.lime)
    }
}
@Composable
internal fun FinancialOrderSummary(view: DriverFinancialView?, confirmed: Boolean = false) {
    val now = financialClock()
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(if (confirmed) "Importes del cobro confirmado" else financialStatus(view, now), style = MaterialTheme.typography.bodySmall,
            color = if (confirmed || view?.totals != null && financialFresh(view, now)) DriverColors.lime else DriverColors.amber)
        view?.totals?.let { totals ->
            HorizontalDivider(color = DriverColors.line)
            FinancialSummaryValue("Importe original", financialMoney(totals.original, view.currency))
            if (totals.deduction.toBigDecimal().signum() != 0) FinancialSummaryValue("Devoluciones y faltantes", "− ${financialMoney(totals.deduction, view.currency)}")
            if (totals.deferred.toBigDecimal().signum() != 0) FinancialSummaryValue("Se cobrará al entregar la reposición", "− ${financialMoney(totals.deferred, view.currency)}")
            if (totals.roundingAdjustment.toBigDecimal().signum() != 0)
                FinancialSummaryValue("Redondeo incluido en el original", financialMoney(totals.roundingAdjustment, view.currency))
            FinancialSummaryValue("Importe actual", financialMoney(totals.net, view.currency), emphasis = true)
        }
        if ((view?.unpricedIncidentCount ?: 0) > 0) Text("${view!!.unpricedIncidentCount} faltante(s) sin partida asociada · sin descuento automático",
            style = MaterialTheme.typography.bodySmall, color = DriverColors.amber)
    }
}
@Composable
private fun FinancialSummaryValue(label: String, value: String, emphasis: Boolean = false) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
        Text(value, style = if (emphasis) MaterialTheme.typography.titleLarge else MaterialTheme.typography.bodyMedium,
            color = if (emphasis) DriverColors.lime else MaterialTheme.colorScheme.onSurface)
    }
}
