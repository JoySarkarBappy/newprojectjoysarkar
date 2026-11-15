package app.srot.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.srot.android.Prefs

/** Icons not in the core Material set, drawn from the Material Symbols paths. */
object SrotIcons {
    private fun icon(name: String, vararg paths: String): ImageVector {
        val b = ImageVector.Builder(
            name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f,
        )
        for (d in paths) b.addPath(pathData = PathParser().parsePathString(d).toNodes(), fill = SolidColor(Color.Black))
        return b.build()
    }

    val Download by lazy { icon("download", "M5,20h14v-2H5V20zM19,9h-4V3H9v6H5l7,7L19,9z") }
    val Pause by lazy { icon("pause", "M6,19h4V5H6V19zM14,5v14h4V5H14z") }
    val Paste by lazy {
        icon(
            "paste",
            "M19,2h-4.18C14.4,0.84 13.3,0 12,0c-1.3,0 -2.4,0.84 -2.82,2H5C3.9,2 3,2.9 3,4v16c0,1.1 0.9,2 2,2h14c1.1,0 2,-0.9 2,-2V4C21,2.9 20.1,2 19,2zM12,2c0.55,0 1,0.45 1,1s-0.45,1 -1,1s-1,-0.45 -1,-1S11.45,2 12,2zM19,20H5V4h2v3h10V4h2V20z",
        )
    }
    val Music by lazy { icon("music", "M12,3v10.55C11.41,13.21 10.73,13 10,13c-2.21,0 -4,1.79 -4,4s1.79,4 4,4s4,-1.79 4,-4V7h4V3H12z") }
    val Movie by lazy { icon("movie", "M18,4l2,4h-3l-2,-4h-2l2,4h-3l-2,-4H8l2,4H7L5,4H4C2.9,4 2.01,4.9 2.01,6L2,18c0,1.1 0.9,2 2,2h16c1.1,0 2,-0.9 2,-2V4H18z") }
    val File by lazy { icon("file", "M6,2C4.9,2 4.01,2.9 4.01,4L4,20c0,1.1 0.89,2 1.99,2H18c1.1,0 2,-0.9 2,-2V8l-6,-6H6zM13,9V3.5L18.5,9H13z") }
    val Open by lazy { icon("open", "M8,5v14l11,-7z") }
    val Globe by lazy {
        icon(
            "globe",
            "M12,2C6.48,2 2,6.48 2,12s4.48,10 10,10s10,-4.48 10,-10S17.52,2 12,2zM11,19.93c-3.95,-0.49 -7,-3.85 -7,-7.93c0,-0.62 0.08,-1.21 0.21,-1.79L9,15v1c0,1.1 0.9,2 2,2V19.93zM17.9,17.39c-0.26,-0.81 -1,-1.39 -1.9,-1.39h-1v-3c0,-0.55 -0.45,-1 -1,-1H8v-2h2c0.55,0 1,-0.45 1,-1V7h2c1.1,0 2,-0.9 2,-2v-0.41c2.93,1.19 5,4.06 5,7.41C20,14.08 19.2,15.97 17.9,17.39z",
        )
    }
}

/** Srot's mark: two waves (srot = current). */
@Composable
fun WaveMark(modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.primary) {
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        val stroke = h * 0.17f
        val left = stroke / 2
        val seg = (w - stroke) / 3f
        for (row in 0..1) {
            val y = h * (0.3f + 0.4f * row)
            val amp = h * 0.16f
            val path = Path()
            path.moveTo(left, y)
            for (i in 0 until 3) {
                val x0 = left + seg * i
                val dir = if (i % 2 == 0) -1f else 1f
                path.cubicTo(x0 + seg * 0.35f, y + dir * amp, x0 + seg * 0.65f, y + dir * amp, x0 + seg, y)
            }
            drawPath(path, color, style = Stroke(width = stroke, cap = StrokeCap.Round))
        }
    }
}

/** Half-filled circle: one tap switches between light and dark. */
@Composable
fun ThemeToggle(modifier: Modifier = Modifier) {
    val dark = LocalDark.current
    val c = MaterialTheme.colorScheme.onSurface
    val label = if (dark) "Switch to light mode" else "Switch to dark mode"
    IconButton(onClick = { Prefs.setTheme(if (dark) "light" else "dark") }, modifier = modifier.semantics { contentDescription = label }) {
        Canvas(Modifier.size(20.dp)) {
            drawCircle(c, style = Stroke(width = 1.8.dp.toPx()))
            drawArc(c, startAngle = 90f, sweepAngle = 180f, useCenter = true)
        }
    }
}

@Composable
fun Credit(modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("Developed by", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            "Joy Sarkar and Dhrubo Das",
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.primary,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
fun Section(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = 14.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(10.dp))
        content()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SegmentedChoice(options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit) {
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        options.forEachIndexed { i, (value, label) ->
            SegmentedButton(
                selected = value == selected,
                onClick = { onSelect(value) },
                shape = SegmentedButtonDefaults.itemShape(index = i, count = options.size),
            ) {
                Text(label, maxLines = 1, style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}
