package app.srot.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.srot.android.Engine
import app.srot.android.firstUrl
import java.net.URLEncoder

private data class Site(val name: String, val mark: String, val color: Color, val url: String)

private val SITES = listOf(
    Site("YouTube", "Y", Color(0xFFD93025), "https://m.youtube.com"),
    Site("Facebook", "f", Color(0xFF1877F2), "https://m.facebook.com"),
    Site("Instagram", "I", Color(0xFFC13584), "https://www.instagram.com"),
    Site("TikTok", "T", Color(0xFF2E3A40), "https://www.tiktok.com"),
    Site("X", "X", Color(0xFF3A464C), "https://x.com"),
    Site("Vimeo", "V", Color(0xFF1593C7), "https://vimeo.com"),
    Site("Dailymotion", "D", Color(0xFF0061D5), "https://www.dailymotion.com"),
    Site("SoundCloud", "S", Color(0xFFE85A0C), "https://m.soundcloud.com"),
)

fun youtubeSearch(query: String): String =
    "https://m.youtube.com/results?search_query=" + URLEncoder.encode(query.trim(), "UTF-8")

@Composable
fun HomeScreen(onAnalyze: (String) -> Unit, onOpenPage: (String) -> Unit) {
    val clipboard = LocalClipboardManager.current
    val focus = LocalFocusManager.current
    val engine by Engine.state.collectAsStateWithLifecycle()
    var text by rememberSaveable { mutableStateOf("") }
    val link = firstUrl(text)

    fun go() {
        val t = text.trim()
        if (t.isEmpty()) return
        focus.clearFocus()
        val url = firstUrl(t)
        if (url != null) onAnalyze(url) else onOpenPage(youtubeSearch(t))
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
    ) {
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            WaveMark(Modifier.size(width = 34.dp, height = 22.dp))
            Spacer(Modifier.width(10.dp))
            Text("Srot", style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
            Spacer(Modifier.weight(1f))
            ThemeToggle()
        }

        Spacer(Modifier.height(22.dp))
        Text("Download videos, music and files", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(4.dp))
        Text(
            "Paste a link from YouTube, Facebook, Instagram, TikTok or any website.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(16.dp))

        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Paste a link, or type to search YouTube") },
            singleLine = true,
            shape = RoundedCornerShape(14.dp),
            trailingIcon = {
                if (text.isEmpty()) {
                    IconButton(onClick = { clipboard.getText()?.text?.trim()?.let { text = it } }) {
                        Icon(SrotIcons.Paste, contentDescription = "Paste")
                    }
                } else {
                    IconButton(onClick = { text = "" }) { Icon(Icons.Filled.Close, contentDescription = "Clear") }
                }
            },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { go() }),
        )
        Spacer(Modifier.height(10.dp))
        Button(
            onClick = { go() },
            enabled = text.isNotBlank(),
            modifier = Modifier.fillMaxWidth().height(52.dp),
            shape = RoundedCornerShape(14.dp),
        ) {
            val search = text.isNotBlank() && link == null
            Icon(if (search) Icons.Filled.Search else SrotIcons.Download, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(if (search) "Search YouTube" else "Download", style = MaterialTheme.typography.titleMedium)
        }

        when (val e = engine) {
            Engine.State.Preparing -> Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
                Text(
                    "Getting the download engine ready. The first start takes a little longer.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            is Engine.State.Failed -> Text(
                "The download engine could not start: ${e.message}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(top = 12.dp),
            )
            is Engine.State.Ready -> Unit
        }

        Spacer(Modifier.height(28.dp))
        Text("Open a site", style = MaterialTheme.typography.titleMedium)
        Text(
            "Find a video there, then tap Download.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(10.dp))
        SITES.chunked(4).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { site -> SiteTile(site, Modifier.weight(1f)) { onOpenPage(site.url) } }
                repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
            }
            Spacer(Modifier.height(6.dp))
        }

        Spacer(Modifier.height(16.dp))
        Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Share, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(12.dp))
                Text(
                    "In YouTube, Facebook or any other app, tap Share on a video and choose Srot.",
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }

        Spacer(Modifier.height(32.dp))
        Credit()
        Spacer(Modifier.height(20.dp))
    }
}

@Composable
private fun SiteTile(site: Site, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier
            .clip(RoundedCornerShape(14.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier.size(52.dp).clip(RoundedCornerShape(16.dp)).background(site.color),
            contentAlignment = Alignment.Center,
        ) {
            Text(site.mark, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 22.sp)
        }
        Spacer(Modifier.height(6.dp))
        Text(site.name, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
