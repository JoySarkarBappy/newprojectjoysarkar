package app.srot.android

import android.app.Application
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.srot.android.ui.SrotRoot
import app.srot.android.ui.SrotTheme
import kotlinx.coroutines.flow.MutableStateFlow

class SrotApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Prefs.init(this)
        Downloads.load(this)
        Notifications.ensureChannels(this)
        Engine.start(this)
    }
}

/** Links and requests arriving from outside the app (Share menu, notification taps). */
object Incoming {
    val url = MutableStateFlow<String?>(null)
    val openDownloads = MutableStateFlow(false)
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) handle(intent)
        // Downloads interrupted last time carry on.
        if (Downloads.items.value.any { it.status == Status.QUEUED }) DownloadService.start(this)
        setContent {
            val mode by Prefs.theme.collectAsStateWithLifecycle()
            SrotTheme(mode) { SrotRoot() }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent?) {
        if (intent == null) return
        if (intent.action == Intent.ACTION_SEND) {
            val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: intent.getStringExtra(Intent.EXTRA_SUBJECT)
            firstUrl(text)?.let { Incoming.url.value = it }
        }
        if (intent.getStringExtra(EXTRA_OPEN) == OPEN_DOWNLOADS) Incoming.openDownloads.value = true
    }

    companion object {
        const val EXTRA_OPEN = "open"
        const val OPEN_DOWNLOADS = "downloads"
    }
}
