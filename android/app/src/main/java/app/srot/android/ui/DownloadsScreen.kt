package app.srot.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.srot.android.DownloadItem
import app.srot.android.Downloads
import app.srot.android.Format
import app.srot.android.Status
import app.srot.android.Storage
import coil.compose.AsyncImage

@Composable
fun DownloadsScreen(onMessage: (String) -> Unit) {
    val context = LocalContext.current
    val list by Downloads.items.collectAsStateWithLifecycle()
    var confirm by remember { mutableStateOf<DownloadItem?>(null) }

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 14.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Downloads", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
            if (list.any { it.status == Status.DONE }) {
                TextButton(onClick = { Downloads.clearFinished() }) { Text("Clear finished") }
            }
        }
        if (list.isEmpty()) {
            Column(
                Modifier.fillMaxSize().padding(32.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                WaveMark(Modifier.size(width = 64.dp, height = 40.dp), color = MaterialTheme.colorScheme.outline)
                Spacer(Modifier.height(16.dp))
                Text("Nothing downloaded yet", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(4.dp))
                Text(
                    "Paste a link on the Home tab, or share a video to Srot from any app.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }
        } else {
            LazyColumn(
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(list, key = { it.id }) { item ->
                    DownloadCard(item, onMessage = onMessage, onDelete = { confirm = item })
                }
            }
        }
    }

    confirm?.let { item ->
        DeleteDialog(
            item = item,
            onDismiss = { confirm = null },
            onConfirm = { deleteFile ->
                Downloads.remove(context, item.id, deleteFile)
                confirm = null
            },
        )
    }
}

@Composable
private fun DownloadCard(item: DownloadItem, onMessage: (String) -> Unit, onDelete: () -> Unit) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    var menu by remember { mutableStateOf(false) }
    val done = item.status == Status.DONE

    Surface(
        onClick = { if (done) Storage.open(context, item.filePath)?.let(onMessage) },
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(start = 12.dp, top = 12.dp, end = 4.dp, bottom = 6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(end = 8.dp)) {
                Box(
                    Modifier
                        .size(width = 88.dp, height = 50.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                    contentAlignment = Alignment.Center,
                ) {
                    if (item.thumbnail != null) {
                        AsyncImage(
                            model = item.thumbnail,
                            contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize(),
                        )
                    } else {
                        Icon(kindIcon(item.kind), contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    }
                }
                Spacer(Modifier.width(12.dp))
                Text(
                    item.title,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
            }
            if (!done && item.status != Status.FAILED) {
                Spacer(Modifier.height(10.dp))
                LinearProgressIndicator(
                    progress = { item.progress / 100f },
                    modifier = Modifier.fillMaxWidth().padding(end = 8.dp).height(4.dp).clip(RoundedCornerShape(2.dp)),
                    color = if (item.status == Status.DOWNLOADING) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                    trackColor = MaterialTheme.colorScheme.surfaceVariant,
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    Format.statusLine(item),
                    style = MaterialTheme.typography.bodySmall,
                    color = when (item.status) {
                        Status.FAILED -> MaterialTheme.colorScheme.error
                        Status.DONE -> MaterialTheme.colorScheme.success
                        else -> MaterialTheme.colorScheme.onSurfaceVariant
                    },
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                when (item.status) {
                    Status.DOWNLOADING, Status.QUEUED ->
                        IconButton(onClick = { Downloads.pause(item.id) }) { Icon(SrotIcons.Pause, contentDescription = "Pause") }
                    Status.PAUSED ->
                        IconButton(onClick = { Downloads.resume(context, item.id) }) { Icon(Icons.Filled.PlayArrow, contentDescription = "Resume") }
                    Status.FAILED ->
                        IconButton(onClick = { Downloads.resume(context, item.id) }) { Icon(Icons.Filled.Refresh, contentDescription = "Try again") }
                    Status.DONE ->
                        IconButton(onClick = { Storage.open(context, item.filePath)?.let(onMessage) }) {
                            Icon(SrotIcons.Open, contentDescription = "Open", tint = MaterialTheme.colorScheme.primary)
                        }
                }
                Box {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "More") }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        if (done) {
                            DropdownMenuItem(text = { Text("Share") }, onClick = {
                                menu = false
                                Storage.share(context, item.filePath)?.let(onMessage)
                            })
                        }
                        DropdownMenuItem(text = { Text("Copy link") }, onClick = {
                            menu = false
                            clipboard.setText(AnnotatedString(item.url))
                            onMessage("Link copied")
                        })
                        DropdownMenuItem(text = { Text(if (done) "Delete" else "Remove") }, onClick = {
                            menu = false
                            onDelete()
                        })
                    }
                }
            }
        }
    }
}

@Composable
private fun DeleteDialog(item: DownloadItem, onDismiss: () -> Unit, onConfirm: (deleteFile: Boolean) -> Unit) {
    val done = item.status == Status.DONE
    var alsoFile by remember { mutableStateOf(done) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (done) "Delete this download?" else "Remove this download?") },
        text = {
            Column {
                Text(item.title, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(8.dp))
                if (done) {
                    Row(
                        Modifier.fillMaxWidth().clickable { alsoFile = !alsoFile },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(checked = alsoFile, onCheckedChange = { alsoFile = it })
                        Text("Also delete the file from the phone")
                    }
                } else {
                    Text("What has downloaded so far will be lost.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(alsoFile) }) {
                Text(if (done) "Delete" else "Remove", color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
