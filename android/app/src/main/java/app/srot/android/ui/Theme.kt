package app.srot.android.ui

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.core.view.WindowCompat

// The river-current palette shared with the desktop app: one teal accent, quiet everything else.
private val Light = lightColorScheme(
    primary = Color(0xFF0B7A85),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFDCEFF1),
    onPrimaryContainer = Color(0xFF06363B),
    secondary = Color(0xFF3F6F76),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFDCEFF1),
    onSecondaryContainer = Color(0xFF06363B),
    background = Color(0xFFF4F7F8),
    onBackground = Color(0xFF14242C),
    surface = Color(0xFFF4F7F8),
    onSurface = Color(0xFF14242C),
    surfaceVariant = Color(0xFFE6ECEF),
    onSurfaceVariant = Color(0xFF5B6E78),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFFFFFFF),
    surfaceContainer = Color(0xFFEDF2F4),
    surfaceContainerHigh = Color(0xFFE7EDF0),
    surfaceContainerHighest = Color(0xFFE1E8EB),
    outline = Color(0xFFB9C6CC),
    outlineVariant = Color(0xFFDDE5E9),
    error = Color(0xFFB3362E),
    onError = Color(0xFFFFFFFF),
)

private val Dark = darkColorScheme(
    primary = Color(0xFF45B9C4),
    onPrimary = Color(0xFF062126),
    primaryContainer = Color(0xFF12333A),
    onPrimaryContainer = Color(0xFFBFE9EE),
    secondary = Color(0xFF8CC7CE),
    onSecondary = Color(0xFF062126),
    secondaryContainer = Color(0xFF12333A),
    onSecondaryContainer = Color(0xFFBFE9EE),
    background = Color(0xFF0E181D),
    onBackground = Color(0xFFE4EDF0),
    surface = Color(0xFF0E181D),
    onSurface = Color(0xFFE4EDF0),
    surfaceVariant = Color(0xFF1D2F37),
    onSurfaceVariant = Color(0xFF8DA1AB),
    surfaceContainerLowest = Color(0xFF0B1418),
    surfaceContainerLow = Color(0xFF142229),
    surfaceContainer = Color(0xFF16252C),
    surfaceContainerHigh = Color(0xFF1A2A32),
    surfaceContainerHighest = Color(0xFF20323A),
    outline = Color(0xFF3A4F58),
    outlineVariant = Color(0xFF22343D),
    error = Color(0xFFF0837B),
    onError = Color(0xFF3B0A06),
)

private val SrotTypography = Typography().let { t ->
    t.copy(
        headlineSmall = t.headlineSmall.copy(fontWeight = FontWeight.SemiBold),
        titleLarge = t.titleLarge.copy(fontWeight = FontWeight.SemiBold),
        titleMedium = t.titleMedium.copy(fontWeight = FontWeight.SemiBold),
        titleSmall = t.titleSmall.copy(fontWeight = FontWeight.SemiBold),
    )
}

val LocalDark = staticCompositionLocalOf { false }

val ColorScheme.success: Color
    @Composable get() = if (LocalDark.current) Color(0xFF6CCB94) else Color(0xFF26734A)

/** mode: "system", "light" or "dark". */
@Composable
fun SrotTheme(mode: String, content: @Composable () -> Unit) {
    val dark = when (mode) {
        "dark" -> true
        "light" -> false
        else -> isSystemInDarkTheme()
    }
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? Activity)?.window ?: return@SideEffect
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = !dark
                isAppearanceLightNavigationBars = !dark
            }
        }
    }
    CompositionLocalProvider(LocalDark provides dark) {
        MaterialTheme(colorScheme = if (dark) Dark else Light, typography = SrotTypography, content = content)
    }
}
