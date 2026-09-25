package com.five.anarutas.driver

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private data class LicenseDocument(val name: String, val chunks: List<String>)

class NavigationLegalActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { DriverTheme { LegalScreen(::finish) } }
    }
}

@Composable
internal fun NavigationSafetyText() {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("La guía es una ayuda: evalúa siempre las condiciones reales de la vía y respeta las señales. El mapa puede diferir de lo que encuentres en la calle.")
        Text("Detente en un lugar seguro antes de editar un punto o atender un pedido. No manipules la app mientras conduces.")
        Text("Revisa las indicaciones para tu unidad. Los peajes y otros cargos de la vía son responsabilidad de quien realiza el recorrido.")
    }
}

@Composable
internal fun NavigationSafetyNotice(onAccepted: () -> Unit, onNotNow: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { if (!saving) onNotNow() },
        title = { Text("Antes de usar la navegación") },
        text = {
            Column(Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                NavigationSafetyText()
                Text("Google mostrará sus propios términos antes de habilitar la guía.", style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
                TextButton(onClick = { context.startActivity(Intent(context, NavigationLegalActivity::class.java)) }) { Text("Avisos y licencias") }
                if (error) Text("No se pudo guardar la confirmación. Inténtalo de nuevo.", color = DriverColors.red)
            }
        },
        confirmButton = {
            TextButton(enabled = !saving, onClick = {
                saving = true
                scope.launch {
                    val saved = withContext(Dispatchers.IO) { runCatching { DriverPreferences(context.applicationContext).acknowledgeNavigationNotice() }.getOrDefault(false) }
                    saving = false
                    error = !saved
                    if (saved) onAccepted()
                }
            }) { Text(if (saving) "Guardando…" else "Entendido") }
        },
        dismissButton = { TextButton(enabled = !saving, onClick = onNotNow) { Text("Ahora no") } },
    )
}

@Composable
private fun LegalScreen(close: () -> Unit) {
    val context = LocalContext.current
    var documents by remember { mutableStateOf<List<LicenseDocument>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var expanded by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        documents = withContext(Dispatchers.IO) {
            runCatching {
                val names = context.assets.list("navigation-notices").orEmpty().sorted()
                check(names.isNotEmpty())
                names.map { name -> LicenseDocument(name, context.assets.open("navigation-notices/$name")
                    .bufferedReader().use { navigationLicenseChunks(it.readText()) }) }
            }.getOrNull()
        }
        failed = documents == null
    }
    Scaffold(containerColor = DriverColors.background, topBar = {
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Wordmark()
            Spacer(Modifier.weight(1f))
            AppIconButton(DriverIcon.CLOSE, "Cerrar avisos", onClick = close)
        }
    }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item { ScreenTitle("Avisos y licencias", "Navegación · Five Rutas ${BuildConfig.VERSION_NAME}") }
            item { AppCard { NavigationSafetyText() } }
            item { Text("Google Maps Navigation SDK · textos originales incluidos en el SDK de esta versión. Se pueden consultar sin conexión.", color = DriverColors.muted, style = MaterialTheme.typography.bodySmall) }
            if (documents == null && !failed) item { CircularProgressIndicator(Modifier.size(24.dp)) }
            if (failed) item { Text("No fue posible leer los avisos incluidos. Cierra esta pantalla y vuelve a intentarlo.", color = DriverColors.red) }
            documents?.forEach { document ->
                item(key = document.name) { ActionRow(DriverIcon.INFO, document.name, if (expanded == document.name) "Ocultar texto completo" else "Consultar texto completo") {
                    expanded = document.name.takeUnless { it == expanded }
                } }
                if (expanded == document.name) items(document.chunks) { chunk -> Text(chunk, style = MaterialTheme.typography.bodySmall, color = DriverColors.ink) }
            }
        }
    }
}
