package app.srot.android.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.srot.android.BuildConfig
import app.srot.android.Downloads
import app.srot.android.Engine
import app.srot.android.Prefs
import app.srot.android.Status
import app.srot.android.Storage
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(onMessage: (String) -> Unit) {
    val theme by Prefs.theme.collectAsStateWithLifecycle()
    val quality by Prefs.quality.collectAsStateWithLifecycle()
    val maxConcurrent by Prefs.maxConcurrent.collectAsStateWithLifecycle()
    val autoUpdate by Prefs.autoUpdate.collectAsStateWithLifecycle()
    val engine by Engine.state.collectAsStateWithLifecycle()
    val updating by Engine.updating.collectAsStateWithLifecycle()
    val items by Downloads.items.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val muted = MaterialTheme.colorScheme.onSurfaceVariant

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
    ) {
        Text("Settings", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(top = 14.dp, bottom = 4.dp))

        Section("Appearance") {
            SegmentedChoice(
                options = listOf("system" to "Phone", "light" to "Light", "dark" to "Dark"),
                selected = theme,
                onSelect = { Prefs.setTheme(it) },
            )
            Text(
                "“Phone” follows the phone's own light or dark setting.",
                style = MaterialTheme.typography.bodySmall,
                color = muted,
                modifier = Modifier.padding(top = 6.dp),
            )
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        Section("Downloads") {
            Text("Saved to", style = MaterialTheme.typography.labelLarge, color = muted)
            Text(Storage.LABEL, style = MaterialTheme.typography.bodyLarge)
            Spacer(Modifier.height(14.dp))
            Text("Quality picked first", style = MaterialTheme.typography.labelLarge, color = muted)
            Spacer(Modifier.height(6.dp))
            SegmentedChoice(
                options = listOf("best" to "Best", "1080" to "1080p", "720" to "720p", "480" to "480p", "mp3" to "MP3"),
                selected = quality,
                onSelect = { Prefs.setQuality(it) },
            )
            Spacer(Modifier.height(14.dp))
            Text("Downloads at the same time", style = MaterialTheme.typography.labelLarge, color = muted)
            Spacer(Modifier.height(6.dp))
            SegmentedChoice(
                options = listOf("1" to "1", "2" to "2", "3" to "3"),
                selected = maxConcurrent.toString(),
                onSelect = { Prefs.setMaxConcurrent(it.toInt()) },
            )
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        Section("Download engine") {
            Text(
                when (val e = engine) {
                    Engine.State.Preparing -> "Getting ready…"
                    is Engine.State.Ready -> "yt-dlp ${e.version ?: ""}".trim()
                    is Engine.State.Failed -> "Could not start: ${e.message}"
                },
                style = MaterialTheme.typography.bodyLarge,
            )
            Text(
                "Websites change often. If downloads from a site stop working, update the engine.",
                style = MaterialTheme.typography.bodySmall,
                color = muted,
            )
            Spacer(Modifier.height(10.dp))
            val busy = items.any { it.status == Status.DOWNLOADING }
            Button(
                onClick = { scope.launch { onMessage(Engine.update()) } },
                enabled = engine is Engine.State.Ready && !updating && !busy,
            ) {
                if (updating) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                } else {
                    Text("Update now")
                }
            }
            if (busy) {
                Text("Wait for downloads to finish before updating.", style = MaterialTheme.typography.bodySmall, color = muted)
            }
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Update automatically", style = MaterialTheme.typography.bodyLarge)
                    Text("Once a day, when nothing is downloading", style = MaterialTheme.typography.bodySmall, color = muted)
                }
                Switch(checked = autoUpdate, onCheckedChange = { Prefs.setAutoUpdate(it) })
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        Section("About") {
            Text("Srot ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodyLarge)
            Spacer(Modifier.height(6.dp))
            Text("Developed by", style = MaterialTheme.typography.labelLarge, color = muted)
            Text("Joy Sarkar and Dhrubo Das", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(10.dp))
            Text(
                "Download only what you have the right to save. Videos protected with DRM (Netflix and similar) cannot be downloaded.",
                style = MaterialTheme.typography.bodySmall,
                color = muted,
            )
        }
        Spacer(Modifier.height(24.dp))
    }
}
