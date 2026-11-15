package app.srot.android

import android.content.Context
import android.util.Log
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

const val TAG = "Srot"

/**
 * The download engine: yt-dlp (with Python, ffmpeg and the QuickJS runtime YouTube now needs),
 * all shipped inside the app by youtubedl-android.
 */
object Engine {

    sealed interface State {
        data object Preparing : State
        data class Ready(val version: String?) : State
        data class Failed(val message: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Preparing)
    val state: StateFlow<State> = _state

    private val _updating = MutableStateFlow(false)
    val updating: StateFlow<Boolean> = _updating

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val initDone = CompletableDeferred<Unit>()
    private lateinit var app: Context

    fun start(context: Context) {
        app = context.applicationContext
        scope.launch {
            var autoUpdate = false
            try {
                YoutubeDL.getInstance().init(app)
                FFmpeg.getInstance().init(app)
                val version = YoutubeDL.getInstance().version(app)
                _state.value = State.Ready(version)
                Log.i(TAG, "engine ready version=$version quickjs=${jsRuntime() != null}")
                val dayOld = System.currentTimeMillis() - Prefs.lastEngineUpdate > 20L * 60 * 60 * 1000
                val busy = Downloads.items.value.any { it.status == Status.DOWNLOADING }
                // Claim the update before anyone can start yt-dlp, so nothing runs while it is replaced.
                autoUpdate = Prefs.autoUpdate.value && dayOld && !busy && _updating.compareAndSet(false, true)
            } catch (e: Throwable) {
                _state.value = State.Failed(e.message ?: e.toString())
                Log.e(TAG, "engine failed to start", e)
            } finally {
                initDone.complete(Unit)
            }
            if (autoUpdate) runUpdate()
        }
    }

    suspend fun awaitReady(): Boolean {
        initDone.await()
        return _state.value is State.Ready
    }

    /** Fetch the newest yt-dlp release. Sites change often; an old yt-dlp is the usual cause of failures. */
    suspend fun update(): String {
        if (!awaitReady()) return "The download engine is not ready"
        if (!_updating.compareAndSet(false, true)) return "Already updating"
        return runUpdate()
    }

    /** Callers must have set [_updating]; it is cleared here. */
    private suspend fun runUpdate(): String = withContext(Dispatchers.IO) {
        try {
            val status = YoutubeDL.getInstance().updateYoutubeDL(app)
            Prefs.lastEngineUpdate = System.currentTimeMillis()
            val version = YoutubeDL.getInstance().version(app)
            _state.value = State.Ready(version)
            Log.i(TAG, "engine update status=${status?.name} version=$version")
            if (status?.name == "ALREADY_UP_TO_DATE") "Already up to date" else "Updated to $version"
        } catch (e: Throwable) {
            Log.e(TAG, "engine update failed", e)
            "Update failed: ${cleanError(e.message)}"
        } finally {
            _updating.value = false
        }
    }

    /** yt-dlp must not start while it is being replaced. */
    suspend fun awaitNotUpdating() {
        updating.first { !it }
    }

    /** QuickJS ships as libqjs.so; yt-dlp needs a JavaScript runtime to read YouTube. */
    fun jsRuntime(): String? {
        val file = File(app.applicationInfo.nativeLibraryDir, "libqjs.so")
        return if (file.exists()) "quickjs:${file.absolutePath}" else null
    }

    /** Ask yt-dlp what is at a link, without downloading it. */
    suspend fun analyze(url: String, cookieFile: String?): MediaInfo = withContext(Dispatchers.IO) {
        if (!awaitReady()) {
            val why = (state.value as? State.Failed)?.message ?: "unknown reason"
            throw IllegalStateException("The download engine could not start ($why)")
        }
        awaitNotUpdating()
        val request = YoutubeDLRequest(url)
        request.addOption("-J")
        request.addOption("--no-playlist")
        request.addOption("--flat-playlist")
        request.addOption("--no-warnings")
        jsRuntime()?.let { request.addOption("--js-runtimes", it) }
        cookieFile?.let { request.addOption("--cookies", it) }
        val response = try {
            YoutubeDL.getInstance().execute(request, "analyze-${System.nanoTime()}", null)
        } catch (e: Throwable) {
            Log.w(TAG, "analyze failed url=$url error=${e.message}")
            throw IllegalStateException(cleanError(e.message))
        }
        val out = response.out
        val start = out.indexOf('{')
        if (start < 0) throw IllegalStateException("Nothing to download was found at this link")
        val info = InfoParser.parse(url, JSONObject(out.substring(start)), cookieFile)
        Log.i(TAG, "analyze ok title=${info.title} choices=${info.allChoices.map { it.key }} site=${info.site}")
        info
    }

    /** The yt-dlp command for one download. Every file name carries "[id]" so Srot can find it afterwards. */
    fun downloadRequest(item: DownloadItem, dir: File, target: File? = null): YoutubeDLRequest {
        val r = YoutubeDLRequest(item.url)
        // "%" starts a yt-dlp template field, so a literal one in a file name is doubled.
        val output = target?.absolutePath?.replace("%", "%%") ?: File(dir, "%(title).80B [%(id)s].%(ext)s").absolutePath
        r.addOption("-o", output)
        r.addOption("--windows-filenames")
        r.addOption("--no-playlist")
        r.addOption("--no-mtime")
        r.addOption("--newline")
        r.addOption("--retries", "10")
        r.addOption("--fragment-retries", "10")
        r.addOption("--http-chunk-size", "10M")
        jsRuntime()?.let { r.addOption("--js-runtimes", it) }
        item.cookieFile?.takeIf { File(it).exists() }?.let { r.addOption("--cookies", it) }
        when (item.choiceKey) {
            "mp3" -> {
                r.addOption("-f", "ba/b")
                r.addOption("-x")
                r.addOption("--audio-format", "mp3")
                r.addOption("--audio-quality", "0")
                r.addOption("--embed-metadata")
            }
            "m4a" -> {
                r.addOption("-f", "ba[ext=m4a]/ba/b")
                r.addOption("-x")
                r.addOption("--audio-format", "m4a")
                r.addOption("--embed-metadata")
            }
            "file" -> Unit
            else -> {
                // H.264 + AAC in MP4 plays on every phone; higher sizes only exist as VP9/AV1.
                val res = if (item.choiceKey == "best") "res" else "res:${item.choiceKey}"
                r.addOption("-f", "bv*+ba/b")
                r.addOption("-S", "$res,vcodec:h264,acodec:aac")
                r.addOption("--merge-output-format", "mp4")
            }
        }
        return r
    }
}
