package app.srot.android.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.srot.android.Choice
import app.srot.android.Cookies
import app.srot.android.Downloads
import app.srot.android.Incoming
import app.srot.android.MediaInfo
import app.srot.android.Prefs
import app.srot.android.Status
import kotlinx.coroutines.launch

@Composable
fun SrotRoot() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var browserUrl by rememberSaveable { mutableStateOf<String?>(null) }
    var analyze by remember { mutableStateOf<AnalyzeRequest?>(null) }
    val items by Downloads.items.collectAsStateWithLifecycle()
    val active = items.count { it.status == Status.DOWNLOADING || it.status == Status.QUEUED }

    val incomingUrl by Incoming.url.collectAsStateWithLifecycle()
    LaunchedEffect(incomingUrl) {
        incomingUrl?.let {
            analyze = AnalyzeRequest(it, Cookies.fileFor(context, it))
            Incoming.url.value = null
        }
    }
    val openDownloads by Incoming.openDownloads.collectAsStateWithLifecycle()
    LaunchedEffect(openDownloads) {
        if (openDownloads) {
            browserUrl = null
            tab = 1
            Incoming.openDownloads.value = false
        }
    }

    fun message(text: String) {
        scope.launch { snackbar.showSnackbar(text, duration = SnackbarDuration.Short) }
    }

    // Saving into Download/ needs a permission only on Android 9 and 10; notifications ask on Android 13+.
    var pending by remember { mutableStateOf<Pair<MediaInfo, Choice>?>(null) }
    fun granted(permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    fun startDownload(info: MediaInfo, choice: Choice) {
        val added = Downloads.enqueue(context, info, choice)
        analyze = null
        scope.launch {
            val result = snackbar.showSnackbar(
                if (added) "Added to downloads" else "Already in downloads",
                actionLabel = "View",
                duration = SnackbarDuration.Short,
            )
            if (result == SnackbarResult.ActionPerformed) {
                browserUrl = null
                tab = 1
            }
        }
    }

    val permissions = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        val job = pending
        pending = null
        if (job != null) {
            if (Build.VERSION.SDK_INT <= 29 && !granted(Manifest.permission.WRITE_EXTERNAL_STORAGE)) {
                message("Srot needs permission to save files in your Download folder")
            } else {
                startDownload(job.first, job.second)
            }
        }
    }

    fun requestDownload(info: MediaInfo, choice: Choice) {
        val needed = buildList {
            if (Build.VERSION.SDK_INT <= 29 && !granted(Manifest.permission.WRITE_EXTERNAL_STORAGE)) {
                add(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            }
            if (Build.VERSION.SDK_INT >= 33 && !granted(Manifest.permission.POST_NOTIFICATIONS) && !Prefs.askedNotifications) {
                add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        if (needed.isEmpty()) {
            startDownload(info, choice)
        } else {
            if (Manifest.permission.POST_NOTIFICATIONS in needed) Prefs.askedNotifications = true
            pending = info to choice
            permissions.launch(needed.toTypedArray())
        }
    }

    Box(Modifier.fillMaxSize()) {
        val open = browserUrl
        if (open != null) {
            BrowserScreen(
                startUrl = open,
                onClose = { browserUrl = null },
                onDownload = { url, cookies -> analyze = AnalyzeRequest(url, cookies) },
            )
        } else {
            Scaffold(
                containerColor = MaterialTheme.colorScheme.background,
                bottomBar = {
                    NavigationBar(containerColor = MaterialTheme.colorScheme.surfaceContainerLow) {
                        NavigationBarItem(
                            selected = tab == 0,
                            onClick = { tab = 0 },
                            icon = { Icon(Icons.Filled.Home, contentDescription = null) },
                            label = { Text("Home") },
                        )
                        NavigationBarItem(
                            selected = tab == 1,
                            onClick = { tab = 1 },
                            icon = {
                                BadgedBox(badge = { if (active > 0) Badge { Text(active.toString()) } }) {
                                    Icon(SrotIcons.Download, contentDescription = null)
                                }
                            },
                            label = { Text("Downloads") },
                        )
                        NavigationBarItem(
                            selected = tab == 2,
                            onClick = { tab = 2 },
                            icon = { Icon(Icons.Filled.Settings, contentDescription = null) },
                            label = { Text("Settings") },
                        )
                    }
                },
            ) { padding ->
                Box(Modifier.fillMaxSize().padding(padding)) {
                    when (tab) {
                        0 -> HomeScreen(
                            onAnalyze = { analyze = AnalyzeRequest(it, Cookies.fileFor(context, it)) },
                            onOpenPage = { browserUrl = it },
                        )
                        1 -> DownloadsScreen(onMessage = ::message)
                        else -> SettingsScreen(onMessage = ::message)
                    }
                }
            }
        }
        SnackbarHost(
            snackbar,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(bottom = if (open == null) 80.dp else 8.dp),
        )
    }

    analyze?.let { request ->
        AnalyzeSheet(
            request = request,
            onDismiss = { analyze = null },
            onDownload = { info, choice -> requestDownload(info, choice) },
        )
    }
}
