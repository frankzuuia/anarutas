package com.five.anarutas.driver

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel

private val backdrop = Color(0xFF111613)
private val panel = Color(0xFF1B231D)
private val green = Color(0xFF93CD4B)
private val muted = Color(0xFFB1BEB1)
private val danger = Color(0xFFFFB3AE)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val credentials = DeviceCredentials(applicationContext)
        setContent {
            val model: DriverViewModel = viewModel(factory = DriverViewModel.factory(credentials))
            DriverApp(model)
        }
    }
}

@Composable
private fun DriverApp(model: DriverViewModel) {
    val state = model.state
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = green,
            onPrimary = Color(0xFF17200C),
            background = backdrop,
            onBackground = Color.White,
            surface = panel,
            onSurface = Color.White,
            error = danger,
        ),
    ) {
        Surface(modifier = Modifier.fillMaxSize(), color = backdrop) {
            Column(
                modifier = Modifier.fillMaxSize().safeDrawingPadding()
                    .verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 18.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    Text("Five", fontSize = 35.sp, fontWeight = FontWeight.Bold, color = Color.White)
                    Spacer(Modifier.weight(1f))
                    Text("ANA RUTAS · CHOFER", fontSize = 12.sp, color = green)
                }
                if (state.error.isNotBlank()) {
                    Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF452623))) {
                        Text(state.error, color = danger, modifier = Modifier.padding(16.dp))
                    }
                }
                if (state.notice.isNotBlank()) {
                    Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF203520))) {
                        Text(state.notice, color = green, modifier = Modifier.padding(16.dp))
                    }
                }
                when {
                    state.initializing -> {
                        CircularProgressIndicator(color = green)
                        Text("Abriendo el acceso seguro del celular…", color = muted)
                    }
                    state.token.isBlank() -> AccessScreen(state, model)
                    state.selected != null -> RouteScreen(state, model)
                    else -> PlansScreen(state, model)
                }
            }
        }
    }
}

@Composable
private fun AccessScreen(state: DriverUiState, model: DriverViewModel) {
    Text("Acceso a tu ruta", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
    Text(
        "Introduce el teléfono registrado por administración y tu PIN.",
        color = muted,
    )
    OutlinedTextField(
        value = state.phone,
        onValueChange = model::updatePhone,
        label = { Text("Teléfono del chofer") },
        placeholder = { Text("10 dígitos") },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
    OutlinedTextField(
        value = state.pin,
        onValueChange = model::updatePin,
        label = { Text("PIN de 4 dígitos") },
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
    Button(
        enabled = !state.busy,
        modifier = Modifier.fillMaxWidth().height(56.dp),
        onClick = model::submitAccess,
    ) {
        Text(
            if (state.busy) "Conectando…"
            else "Entrar",
        )
    }
    if (state.deviceId.isNotBlank()) {
        TextButton(enabled = !state.busy, onClick = model::reactivateDevice) {
            Text("Cambiar o reactivar celular")
        }
    }
    Text(
        "El PIN nunca se guarda. El primer acceso vincula automáticamente este celular.",
        color = muted,
        fontSize = 12.sp,
    )
}

@Composable
private fun RouteScreen(state: DriverUiState, model: DriverViewModel) {
    val route = state.selected ?: return
    TextButton(enabled = !state.busy, onClick = model::backToPlans) { Text("‹ Volver a mis rutas") }
    Text(route.label, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
    Text("${route.date} · ${route.vehicle}", color = muted)
    routeStatusMessage(route.routeStatus)?.let { message ->
        Text(message, color = danger)
    }
    if (route.orders.isEmpty()) {
        Text("Esta ruta no tiene pedidos asignados.", color = muted)
    }
    route.orders.forEach { order -> OrderCard(order) }
}

@Composable
private fun PlansScreen(state: DriverUiState, model: DriverViewModel) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("Mis rutas", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.weight(1f))
        TextButton(enabled = !state.busy, onClick = model::refreshPlans) { Text("Actualizar") }
    }
    Text("Sólo aparecen los planes asignados a tu camioneta.", color = muted)
    if (state.busy) CircularProgressIndicator(color = green)
    if (!state.busy && state.error.isBlank() && state.plans.isEmpty()) {
        Text("No tienes rutas asignadas. Consulta con administración.", color = muted)
    }
    state.plans.forEach { summary ->
        Card(colors = CardDefaults.cardColors(containerColor = panel), modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(summary.label, fontWeight = FontWeight.Bold, fontSize = 19.sp)
                Text("${summary.date} · ${summary.vehicle}", color = muted)
                Text("${summary.orderCount} pedidos", color = green)
                Button(enabled = !state.busy, onClick = { model.selectPlan(summary.id) }) {
                    Text("Ver pedidos")
                }
            }
        }
    }
    OutlinedButton(
        enabled = !state.busy,
        onClick = model::logout,
        border = BorderStroke(1.dp, green),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = green),
    ) { Text("Cerrar sesión") }
}

@Composable
private fun OrderCard(order: DeliveryOrder) {
    Card(colors = CardDefaults.cardColors(containerColor = panel), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text("PARADA ${order.position}", color = green, fontWeight = FontWeight.Bold, fontSize = 12.sp)
            Text(order.customer, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            Text("Pedido ${order.name}", color = muted)
            Text(order.address)
            if (order.eta != null) Text("Llegada estimada: ${order.eta}", color = muted, fontSize = 12.sp)
            if (!order.phone.isNullOrBlank()) Text("Teléfono: ${order.phone}", color = muted)
            if (order.note.isNotBlank()) Text(order.note, color = muted)
            Spacer(Modifier.height(4.dp))
            order.lines.forEach { line ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(line.name, modifier = Modifier.weight(1f))
                    Text("${line.quantity} ${line.unit}", color = green)
                }
            }
        }
    }
}
