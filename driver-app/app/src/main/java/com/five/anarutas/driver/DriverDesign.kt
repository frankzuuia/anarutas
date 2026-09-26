package com.five.anarutas.driver

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

internal object DriverColors {
    val background = Color(0xFF0D0F12)
    val surface = Color(0xFF171A1F)
    val raised = Color(0xFF20242A)
    val line = Color(0xFF30353C)
    val ink = Color(0xFFF4F5F1)
    val muted = Color(0xFFA2A9B2)
    val lime = Color(0xFFD0F58A)
    val limeInk = Color(0xFF1D2B10)
    val blue = Color(0xFF9BCDF6)
    val purple = Color(0xFFC5B3F4)
    val amber = Color(0xFFF4CF8C)
    val red = Color(0xFFFFB4AB)
}

@Composable
internal fun DriverTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = DriverColors.lime, onPrimary = DriverColors.limeInk,
            background = DriverColors.background, onBackground = DriverColors.ink,
            surface = DriverColors.surface, onSurface = DriverColors.ink,
            surfaceVariant = DriverColors.raised, onSurfaceVariant = DriverColors.muted,
            outline = DriverColors.line, error = DriverColors.red,
        ),
        shapes = Shapes(small = RoundedCornerShape(12.dp), medium = RoundedCornerShape(18.dp), large = RoundedCornerShape(24.dp)),
        typography = Typography(
            headlineLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 32.sp, lineHeight = 37.sp, fontWeight = FontWeight.Bold, letterSpacing = (-1).sp),
            headlineMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 26.sp, lineHeight = 32.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.7).sp),
            titleLarge = TextStyle(fontSize = 21.sp, lineHeight = 27.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.4).sp),
            titleMedium = TextStyle(fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.SemiBold),
            bodyLarge = TextStyle(fontSize = 15.sp, lineHeight = 22.sp),
            bodyMedium = TextStyle(fontSize = 13.sp, lineHeight = 19.sp),
            bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 17.sp),
            labelLarge = TextStyle(fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold),
            labelSmall = TextStyle(fontSize = 10.sp, lineHeight = 14.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.8.sp),
        ), content = content,
    )
}

/** Local vectors share one optical weight and never need network image loading. */
internal enum class DriverIcon(val path: String) {
    MENU("M4 7H20 M4 12H15 M4 17H20"),
    CLOSE("M6 6L18 18 M18 6L6 18"),
    HOME("M3 10L12 3L21 10V20H15V14H9V20H3Z"),
    ROUTE("M6 8A3 3 0 1 0 6 2A3 3 0 0 0 6 8 M18 22A3 3 0 1 0 18 16A3 3 0 0 0 18 22 M6 8V14A4 4 0 0 0 10 18H15 M9 5H17A3 3 0 0 1 17 11H13"),
    ORDERS("M3 7L12 3L21 7V17L12 21L3 17Z M3 7L12 11L21 7 M12 11V21 M7 5L16 9"),
    TRUCK("M3 5H15V17H3Z M15 9H19L22 13V17H15 M6 20A2 2 0 1 0 6 16A2 2 0 0 0 6 20 M18 20A2 2 0 1 0 18 16A2 2 0 0 0 18 20"),
    CAMERA("M3 7H7L9 4H15L17 7H21V20H3Z M16 13A4 4 0 1 0 8 13A4 4 0 0 0 16 13"),
    HISTORY("M3 10A9 9 0 1 1 5 18 M3 4V10H9 M12 7V12L15 14"),
    PROFILE("M16 7A4 4 0 1 0 8 7A4 4 0 0 0 16 7 M4 21V19A8 6 0 0 1 20 19V21"),
    SETTINGS("M4 7H20 M4 17H20 M9 4V10 M16 14V20"),
    CHEVRON("M9 5L16 12L9 19"),
    CHEVRON_DOWN("M5 9L12 16L19 9"),
    CHEVRON_UP("M5 15L12 8L19 15"),
    ARROW("M5 12H19 M13 6L19 12L13 18"),
    NORTH_EAST("M6 18L18 6 M6 6H18V18"),
    MAP("M3 5L9 3L15 6L21 3V19L15 22L9 19L3 21Z M9 3V19 M15 6V22"),
    VOLUME("M3 9H7L12 5V19L7 15H3Z M16 9C18 11 18 13 16 15 M19 6C23 9 23 15 19 18"),
    VOLUME_OFF("M3 9H7L12 5V19L7 15H3Z M16 9L21 15 M21 9L16 15"),
    REFRESH("M20 10A8 8 0 0 0 6 5L3 8 M3 3V8H8 M4 14A8 8 0 0 0 18 19L21 16 M16 16H21V21"),
    LOGOUT("M9 3H4V21H9 M10 12H21 M16 7L21 12L16 17"),
    CLOCK("M21 12A9 9 0 1 0 3 12A9 9 0 0 0 21 12 M12 7V12L16 14"),
    PIN("M19 10C19 15 12 22 12 22C12 22 5 15 5 10A7 7 0 0 1 19 10 M15 10A3 3 0 1 0 9 10A3 3 0 0 0 15 10"),
    SHIELD("M12 3L20 6V12C20 17 12 22 12 22C12 22 4 17 4 12V6Z M8 12L11 15L16 9"),
    SEARCH("M17 10A7 7 0 1 0 3 10A7 7 0 0 0 17 10 M15 15L21 21"),
    CHECK("M5 12L10 17L20 6"),
    TRASH("M3 6H21 M9 6V3H15V6 M6 6L7 21H17L18 6 M10 10V17 M14 10V17"),
    PHOTO("M3 3H21V21H3Z M3 17L8 12L13 17L17 13L21 17 M17 7A1 1 0 1 0 15 7A1 1 0 0 0 17 7"),
    INFO("M21 12A9 9 0 1 0 3 12A9 9 0 0 0 21 12 M12 11V17 M12 7V8"),
    LOCK("M6 10H18V21H6Z M8 10V6A4 4 0 0 1 16 6V10 M12 14V17"),
    PHONE("M7 3L10 8L7 11C9 14 10 15 13 17L16 14L21 17V21C11 23 1 13 3 3Z"),
    ALERT("M12 3L22 21H2Z M12 9V14 M12 17V18"),
    SUN("M16 12A4 4 0 1 0 8 12A4 4 0 0 0 16 12 M12 2V4 M12 20V22 M2 12H4 M20 12H22 M5 5L6 6 M18 18L19 19 M5 19L6 18 M18 6L19 5"),
}

private val iconVectors = DriverIcon.entries.associateWith { icon ->
    ImageVector.Builder(icon.name, 24.dp, 24.dp, 24f, 24f).addPath(
        pathData = PathParser().parsePathString(icon.path).toNodes(),
        fill = null, stroke = SolidColor(Color.Black), strokeLineWidth = 1.7f,
        strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round,
    ).build()
}

@Composable
internal fun AppIcon(icon: DriverIcon, modifier: Modifier = Modifier, tint: Color = DriverColors.ink, description: String? = null) {
    Icon(iconVectors.getValue(icon), contentDescription = description, tint = tint, modifier = modifier.size(22.dp))
}

@Composable
internal fun AppIconButton(icon: DriverIcon, label: String, enabled: Boolean = true, onClick: () -> Unit) {
    IconButton(onClick = onClick, enabled = enabled, modifier = Modifier.size(48.dp)) {
        AppIcon(icon, tint = if (enabled) DriverColors.ink else DriverColors.muted, description = label)
    }
}

@Composable
internal fun AppAction(label: String, icon: DriverIcon, modifier: Modifier = Modifier, enabled: Boolean = true, quiet: Boolean = false, onClick: () -> Unit) {
    Button(
        onClick = onClick, enabled = enabled, modifier = modifier.heightIn(min = 48.dp),
        shape = RoundedCornerShape(14.dp), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = if (quiet) DriverColors.raised else DriverColors.lime,
            contentColor = if (quiet) DriverColors.ink else DriverColors.limeInk,
            disabledContainerColor = DriverColors.raised, disabledContentColor = DriverColors.muted,
        ),
    ) {
        AppIcon(icon, Modifier.size(18.dp), tint = LocalContentColor.current)
        Spacer(Modifier.width(8.dp))
        Text(label, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
internal fun AppCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Surface(modifier = modifier.fillMaxWidth(), color = DriverColors.surface, shape = RoundedCornerShape(20.dp), border = BorderStroke(1.dp, DriverColors.line.copy(alpha = .6f))) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp), content = content)
    }
}

@Composable
internal fun ScreenTitle(title: String, subtitle: String? = null) {
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(title, style = MaterialTheme.typography.headlineMedium, modifier = Modifier.semantics { heading() })
        subtitle?.let { Text(it, color = DriverColors.muted, style = MaterialTheme.typography.bodyMedium) }
    }
}

@Composable
internal fun SectionLabel(title: String, detail: String? = null) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, modifier = Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.titleMedium)
        detail?.let { Text(it, color = DriverColors.muted, style = MaterialTheme.typography.bodySmall) }
    }
}

@Composable
internal fun StatusBadge(label: String, color: Color = DriverColors.lime) {
    Surface(color = color.copy(alpha = .10f), shape = RoundedCornerShape(8.dp)) {
        Row(Modifier.padding(horizontal = 9.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(Modifier.size(5.dp).background(color, CircleShape))
            Text(label, color = color, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
internal fun EmptyPanel(title: String, message: String, icon: DriverIcon = DriverIcon.ROUTE) {
    AppCard {
        AppIcon(icon, Modifier.size(28.dp), tint = DriverColors.muted)
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(message, color = DriverColors.muted, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
internal fun DriverAvatar(name: String, modifier: Modifier = Modifier) {
    Box(modifier.size(40.dp).background(DriverColors.lime.copy(alpha = .12f), CircleShape), contentAlignment = Alignment.Center) {
        Text(name.trim().take(1).uppercase().ifBlank { "F" }, color = DriverColors.lime, fontWeight = FontWeight.Bold, fontSize = 16.sp)
    }
}

@Composable
internal fun Wordmark() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Image(
            painterResource(R.drawable.five_logo), contentDescription = "Five Fine Vegetables", contentScale = ContentScale.Crop,
            colorFilter = ColorFilter.colorMatrix(ColorMatrix(floatArrayOf(
                0f, 0f, 0f, 0f, 255f,
                0f, 0f, 0f, 0f, 255f,
                0f, 0f, 0f, 0f, 255f,
                .2126f, .7152f, .0722f, 0f, 0f,
            ))), modifier = Modifier.width(80.dp).height(46.dp),
        )
        Text("RUTAS", style = MaterialTheme.typography.labelSmall, color = DriverColors.muted)
    }
}

@Composable
internal fun ActionRow(icon: DriverIcon, title: String, subtitle: String, onClick: () -> Unit) {
    Surface(onClick = onClick, color = DriverColors.surface, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(13.dp)) {
            AppIcon(icon, tint = DriverColors.lime)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium)
                Text(subtitle, color = DriverColors.muted, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            AppIcon(DriverIcon.CHEVRON, Modifier.size(16.dp), tint = DriverColors.muted)
        }
    }
}
