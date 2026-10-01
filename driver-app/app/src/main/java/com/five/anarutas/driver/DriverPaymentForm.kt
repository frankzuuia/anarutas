package com.five.anarutas.driver

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private data class PaymentChoice(val method: String, val emoji: String, val detail: String, val accent: Color)
private val paymentChoices = listOf(
    PaymentChoice("cash", "💵", "Dinero recibido en mano", DriverColors.lime),
    PaymentChoice("transfer", "🏦", "Pago enviado a la cuenta", DriverColors.blue),
    PaymentChoice("credit", "🧾", "El cliente pagará después", DriverColors.purple),
)

@Composable
internal fun PaymentMethodPicker(selected: String, enabled: Boolean, onSelect: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().selectableGroup(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        paymentChoices.forEach { choice ->
            val checked = selected == choice.method
            Surface(
                color = if (checked) choice.accent.copy(alpha = .10f) else DriverColors.raised,
                shape = RoundedCornerShape(20.dp),
                border = BorderStroke(if (checked) 1.5.dp else 1.dp, if (checked) choice.accent else DriverColors.line),
                modifier = Modifier.fillMaxWidth().heightIn(min = 88.dp).alpha(if (enabled) 1f else .55f)
                    .selectable(checked, enabled = enabled, role = Role.RadioButton, onClick = { onSelect(choice.method) }),
            ) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.size(48.dp).background(choice.accent.copy(alpha = .10f), RoundedCornerShape(15.dp)),
                        contentAlignment = Alignment.Center) {
                        Text(choice.emoji, fontSize = 26.sp, modifier = Modifier.clearAndSetSemantics {})
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(paymentMethodLabel(choice.method), style = MaterialTheme.typography.titleLarge,
                            color = if (checked) choice.accent else DriverColors.ink)
                        Text(choice.detail, style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
                    }
                    RadioButton(checked, onClick = null, enabled = enabled,
                        colors = RadioButtonDefaults.colors(selectedColor = choice.accent, unselectedColor = DriverColors.muted))
                }
            }
        }
    }
}

@Composable
internal fun PaymentReceivedField(method: String, value: String, enabled: Boolean, onValueChange: (String) -> Unit) {
    when (method) {
        "cash", "transfer" -> OutlinedTextField(value, onValueChange,
            label = { Text(if (method == "cash") "Efectivo recibido" else "Monto transferido") },
            supportingText = { Text(if (method == "cash") "Anota el efectivo que conservas de este pago."
                else "Anota cuánto transfirió el cliente. El importe es obligatorio.") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.fillMaxWidth(), singleLine = true, enabled = enabled)
        "credit" -> Text("El importe queda a crédito; no se registra dinero recibido.",
            style = MaterialTheme.typography.bodyMedium, color = DriverColors.purple)
    }
}
