package com.five.anarutas.driver

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/** The dialog owns IME insets, not the map activity or its content-size changes. */
@Composable
internal fun ServiceFormSurface(onDismiss: () -> Unit, header: @Composable () -> Unit,
    content: @Composable ColumnScope.() -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(
        usePlatformDefaultWidth = false, decorFitsSystemWindows = false, dismissOnClickOutside = false,
    )) {
        Box(Modifier.fillMaxSize().safeDrawingPadding().imePadding().padding(horizontal = 18.dp, vertical = 12.dp),
            contentAlignment = Alignment.TopCenter) {
            Surface(color = DriverColors.surface, shape = RoundedCornerShape(26.dp),
                border = BorderStroke(1.dp, DriverColors.line),
                modifier = Modifier.widthIn(max = 520.dp).fillMaxWidth().fillMaxHeight()) {
                Column(Modifier.fillMaxSize()) {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 14.dp)) { header() }
                    HorizontalDivider(color = DriverColors.line)
                    Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp), content = content)
                }
            }
        }
    }
}

@Composable
internal fun IncidentChoiceCard(choice: IncidentChoice, selected: Boolean, enabled: Boolean, onSelect: () -> Unit) {
    val accent = if (enabled && selected) DriverColors.lime else if (enabled) DriverColors.ink else DriverColors.muted
    Surface(color = if (selected) DriverColors.lime.copy(alpha = .07f) else DriverColors.raised,
        border = BorderStroke(if (selected) 1.5.dp else 1.dp, if (selected && enabled) DriverColors.lime else DriverColors.line),
        shape = RoundedCornerShape(18.dp),
        modifier = Modifier.fillMaxWidth().heightIn(min = 76.dp)
            .selectable(selected = selected, enabled = enabled, role = Role.RadioButton, onClick = onSelect)) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Box(Modifier.size(44.dp).background(accent.copy(alpha = .08f), RoundedCornerShape(13.dp)), contentAlignment = Alignment.Center) {
                AppIcon(choice.icon, Modifier.size(28.dp), tint = accent)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(choice.label, style = MaterialTheme.typography.titleMedium, color = accent)
                Text(choice.detail, style = MaterialTheme.typography.bodySmall, color = DriverColors.muted)
            }
            Surface(color = if (selected) accent else DriverColors.surface, shape = CircleShape,
                border = if (selected) null else BorderStroke(1.dp, DriverColors.line), modifier = Modifier.size(26.dp)) {
                if (selected) Box(contentAlignment = Alignment.Center) {
                    AppIcon(DriverIcon.CHECK, Modifier.size(16.dp), tint = DriverColors.limeInk)
                }
            }
        }
    }
}

@Composable
internal fun ServiceNoteField(value: String, onValueChange: (String) -> Unit, label: String, enabled: Boolean,
    modifier: Modifier = Modifier) {
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    OutlinedTextField(value, { onValueChange(incidentNote(it)) }, modifier = modifier.fillMaxWidth(),
        minLines = 2, maxLines = 4, enabled = enabled, label = { Text(label) },
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { focus.clearFocus(); keyboard?.hide() }))
}
