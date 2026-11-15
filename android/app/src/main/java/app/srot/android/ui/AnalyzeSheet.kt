package app.srot.android.ui

import android.net.Uri
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.srot.android.Choice
import app.srot.android.Engine
import app.srot.android.Format
import app.srot.android.InfoParser
import app.srot.android.Kind
import app.srot.android.MediaInfo
import app.srot.android.Prefs
import coil.compose.AsyncImage
import kotlinx.coroutines.CancellationException

data class AnalyzeRequest(val url: String, val cookieFile: String?)

private sealed interface Load {
    data object Loading : Load
    data class Done(val info: MediaInfo) : Load
    data class Failed(val message: String) : Load
}

/** Reads a link with yt-dlp and lets the user pick a quality, like Snaptube's download sheet. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AnalyzeSheet(request: AnalyzeRequest, onDismiss: () -> Unit, onDownload: (MediaInfo, Choice) -> Unit) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var attempt by remember { mutableIntStateOf(0) }
    val load by produceState<Load>(Load.Loading, request, attempt) {
        value = Load.Loading
        value = try {
            Load.Done(Engine.analyze(request.url, request.cookieFile))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Load.Failed(e.message ?: "Could not read this link")
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 24.dp)) {
            when (val l = load) {
                Load.Loading -> LoadingBody(request.url)
                is Load.Failed -> FailedBody(l.message, onRetry = { attempt++ }, onClose = onDismiss)
                is Load.Done -> ChoicesBody(l.info, onDownload, onDismiss)
            }
        }
    }
}

@Composable
private fun LoadingBody(url: String) {
    val engine by Engine.state.collectAsStateWithLifecycle()
    Row(Modifier.fillMaxWidth().padding(vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 3.dp)
        Spacer(Modifier.width(16.dp))
        Column {
            Text(
                if (engine == Engine.State.Preparing) "Getting the download engine ready…" else "Reading the link…",
                style = MaterialTheme.typography.titleMedium,
            )
            Text(
                Uri.parse(url).host ?: url,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
    Text(
        "YouTube can take up to half a minute.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun FailedBody(message: String, onRetry: () -> Unit, onClose: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
        Icon(Icons.Filled.Warning, contentDescription = null, tint = MaterialTheme.colorScheme.error)
        Spacer(Modifier.width(10.dp))
        Text("Could not read this link", style = MaterialTheme.typography.titleMedium)
    }
    Spacer(Modifier.height(8.dp))
    Text(message, style = MaterialTheme.typography.bodyMedium)
    Spacer(Modifier.height(8.dp))
    val botCheck = message.contains("not a bot", ignoreCase = true) || message.contains("Sign in to confirm", ignoreCase = true)
    Text(
        if (botCheck) {
            "YouTube wants a sign-in from this internet connection. On Srot's Home, tap YouTube, sign in once, then try again."
        } else {
            "Check that the video is public and the link is complete. If a site stops working, update the engine in Settings."
        },
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(16.dp))
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        TextButton(onClick = onClose) { Text("Close") }
        Spacer(Modifier.width(8.dp))
        Button(onClick = onRetry) { Text("Try again") }
    }
}

@Composable
private fun ChoicesBody(info: MediaInfo, onDownload: (MediaInfo, Choice) -> Unit, onClose: () -> Unit) {
    var selected by remember(info) { mutableStateOf(InfoParser.preferred(info, Prefs.quality.value)) }

    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(width = 120.dp, height = 68.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant),
            contentAlignment = Alignment.Center,
        ) {
            if (info.thumbnail != null) {
                AsyncImage(
                    model = info.thumbnail,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            } else {
                Icon(kindIcon(info.allChoices.firstOrNull()?.kind ?: Kind.FILE), contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            }
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(info.title, style = MaterialTheme.typography.titleMedium, maxLines = 3, overflow = TextOverflow.Ellipsis)
            val meta = listOfNotNull(info.uploader, info.durationSec?.let { Format.clock(it.toLong()) }).joinToString(" · ")
            if (meta.isNotEmpty()) {
                Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
        }
    }
    Spacer(Modifier.height(16.dp))

    if (info.isPlaylist || info.allChoices.isEmpty()) {
        Text(
            if (info.isPlaylist) "This link is a playlist. Open one video from it and download that link."
            else "Nothing to download was found at this link.",
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(16.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = onClose) { Text("Close") }
        }
        return
    }

    Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
        if (info.videoChoices.isNotEmpty()) {
            GroupLabel("Video")
            info.videoChoices.forEach { c -> ChoiceRow(c, c == selected) { selected = c } }
        }
        if (info.audioChoices.isNotEmpty()) {
            GroupLabel("Audio only")
            info.audioChoices.forEach { c -> ChoiceRow(c, c == selected) { selected = c } }
        }
        info.fileChoice?.let { c ->
            GroupLabel("File")
            ChoiceRow(c, c == selected) { selected = c }
        }
    }
    Spacer(Modifier.height(14.dp))
    Button(
        onClick = { selected?.let { onDownload(info, it) } },
        enabled = selected != null,
        modifier = Modifier.fillMaxWidth().height(52.dp),
        shape = RoundedCornerShape(14.dp),
    ) {
        Icon(SrotIcons.Download, contentDescription = null)
        Spacer(Modifier.width(8.dp))
        Text("Download ${selected?.label ?: ""}".trim(), style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun GroupLabel(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = 10.dp, bottom = 4.dp, start = 4.dp),
    )
}

@Composable
private fun ChoiceRow(choice: Choice, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) MaterialTheme.colorScheme.primaryContainer else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(end = 14.dp, top = 2.dp, bottom = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = onClick)
        Column(Modifier.weight(1f)) {
            Text(choice.label, style = MaterialTheme.typography.titleSmall)
            choice.detail?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        val size = Format.bytes(choice.sizeBytes)
        if (size.isNotEmpty()) {
            Text("≈ $size", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

fun kindIcon(kind: Kind) = when (kind) {
    Kind.VIDEO -> SrotIcons.Movie
    Kind.AUDIO -> SrotIcons.Music
    Kind.FILE -> SrotIcons.File
}
