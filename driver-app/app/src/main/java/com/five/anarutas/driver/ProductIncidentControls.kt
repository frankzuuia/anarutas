package com.five.anarutas.driver

import android.graphics.BitmapFactory
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.math.BigDecimal

@Composable
internal fun ProductQuantityField(kind: ProductIncidentKind, quantity: String, unit: String,
    remaining: BigDecimal?, editable: Boolean, onQuantity: (String) -> Unit) {
    OutlinedTextField(quantity, { onQuantity(it.take(20)) }, modifier = Modifier.fillMaxWidth(),
        label = { Text(if (kind == ProductIncidentKind.RETURN) "Cantidad devuelta · $unit" else "Cantidad afectada · $unit") },
        enabled = editable, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
    if (remaining != null) TextButton(enabled = editable && remaining.signum() > 0,
        onClick = { onQuantity(remaining.stripTrailingZeros().toPlainString()) }) { Text("Usar toda la cantidad disponible") }
}

@Composable
internal fun ProductSelectField(label: String, value: String, options: List<Pair<String, String>>, enabled: Boolean,
    modifier: Modifier = Modifier, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Column(modifier) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = DriverColors.muted)
        Box {
            OutlinedButton(onClick = { expanded = true }, enabled = enabled,
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
                contentPadding = PaddingValues(horizontal = 10.dp, vertical = 8.dp), shape = RoundedCornerShape(10.dp)) {
                Text(options.firstOrNull { it.first == value }?.second ?: "Seleccionar", Modifier.weight(1f),
                    style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text("▾", Modifier.padding(start = 4.dp))
            }
            DropdownMenu(expanded && enabled, { expanded = false }) {
                options.forEach { (code, name) -> DropdownMenuItem(text = { Text(name) }, onClick = { expanded = false; onSelect(code) }) }
            }
        }
    }
}

@Composable
internal fun ProductClassificationFields(kind: ProductIncidentKind, department: String, concept: String,
    editable: Boolean, onDepartment: (String) -> Unit, onConcept: (String) -> Unit) {
    if (productClassificationRequired(kind)) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        ProductSelectField("Departamento", department, productDepartments.map { it to it }, editable, Modifier.weight(1f), onDepartment)
        ProductSelectField("Concepto", concept, productConcepts.map { it to it }, editable, Modifier.weight(1f), onConcept)
    }
}

@Composable
internal fun ShortageProductFields(product: String, quantity: String, unit: String, enabled: Boolean,
    onProduct: (String) -> Unit, onQuantity: (String) -> Unit, onUnit: (String) -> Unit) {
    OutlinedTextField(product, { onProduct(it.take(300)) }, modifier = Modifier.fillMaxWidth(),
        label = { Text("Producto faltante") }, enabled = enabled, singleLine = true)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(quantity, { onQuantity(it.take(20)) }, modifier = Modifier.weight(1f),
            label = { Text("Cantidad faltante") }, placeholder = { Text("Ej. 1") }, enabled = enabled,
            singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
        OutlinedTextField(unit, { onUnit(it.take(40)) }, modifier = Modifier.weight(1f),
            label = { Text("Unidad") }, placeholder = { Text("kg, piezas, cajas…") }, enabled = enabled, singleLine = true)
    }
}

@Composable
internal fun ProductCommentChoices(selected: List<String>, enabled: Boolean,
    options: List<ProductComment> = ProductComment.entries, onChange: (List<String>) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text("Comentarios rápidos", style = MaterialTheme.typography.labelLarge)
        Text(if (options.size == 1) "Selecciona si aplica y agrega tus notas abajo." else "Puedes elegir varios y agregar tus notas abajo.",
            style = MaterialTheme.typography.labelSmall, color = DriverColors.muted)
        options.forEach { option ->
            FilterChip(selected = option.code in selected, onClick = {
                onChange(if (option.code in selected) selected - option.code else selected + option.code)
            }, enabled = enabled, modifier = Modifier.fillMaxWidth(),
                label = { Text(option.label, style = MaterialTheme.typography.bodySmall) },
                leadingIcon = if (option.code in selected) ({ AppIcon(DriverIcon.CHECK, Modifier.size(16.dp), tint = DriverColors.lime) }) else null,
                colors = FilterChipDefaults.filterChipColors(selectedContainerColor = DriverColors.lime.copy(alpha = .12f), selectedLabelColor = DriverColors.lime))
        }
        val previous = ProductComment.entries.filter { it.code in selected && it !in options }
        if (previous.isNotEmpty()) Text("Comentarios registrados: ${previous.joinToString(" · ") { it.label }}",
            style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
    }
}

@Composable
internal fun CapturedProductPhoto(path: String, number: Int, editable: Boolean, onReady: (Boolean) -> Unit, onRemove: () -> Unit) {
    var loading by remember(path) { mutableStateOf(true) }
    val preview by produceState<ImageBitmap?>(null, path) {
        value = null
        value = withContext(Dispatchers.IO) {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(path, bounds)
            var sample = 1
            while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 320) sample *= 2
            BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
        }
        loading = false
    }
    LaunchedEffect(path, preview) { onReady(preview != null) }
    Surface(shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, DriverColors.line), modifier = Modifier.size(88.dp)) {
        Box {
            if (preview != null) Image(preview!!, "Evidencia $number", Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            else Text(if (loading) "Cargando…" else "No se pudo\nleer la foto", style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.align(Alignment.BottomCenter).padding(6.dp))
            Surface(color = DriverColors.surface.copy(alpha = .95f), shape = RoundedCornerShape(bottomStart = 12.dp), modifier = Modifier.align(Alignment.TopEnd)) {
                IconButton(onClick = onRemove, enabled = editable, modifier = Modifier.size(32.dp).semantics { contentDescription = "Quitar foto $number" }) {
                    AppIcon(DriverIcon.CLOSE, Modifier.size(16.dp))
                }
            }
        }
    }
}
