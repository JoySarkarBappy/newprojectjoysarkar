package app.srot.android

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.yausername.youtubedl_android.YoutubeDL
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.ConcurrentHashMap

private enum class StopKind { PAUSE, REMOVE }

/**
 * Runs the download queue in the background with a notification, so downloads keep going
 * when the screen is off or another app is open.
 */
class DownloadService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val jobs = HashMap<String, Job>()
    private var loop: Job? = null
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Notifications.ensureChannels(this)
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "srot:downloads").apply { setReferenceCounted(false) }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val type = if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0
        ServiceCompat.startForeground(this, Notifications.PROGRESS_ID, Notifications.progress(this, Downloads.items.value), type)
        wakeLock?.acquire(6L * 60 * 60 * 1000)
        if (loop?.isActive != true) loop = scope.launch { runQueue() }
        return START_NOT_STICKY
    }

    private suspend fun runQueue() {
        if (!Engine.awaitReady()) {
            val why = (Engine.state.value as? Engine.State.Failed)?.message ?: "unknown reason"
            Downloads.items.value.filter { it.status == Status.QUEUED }.forEach { item ->
                Downloads.update(item.id) { it.copy(status = Status.FAILED, error = "The download engine could not start ($why)") }
            }
            finish()
            return
        }
        while (true) {
            val max = Prefs.maxConcurrent.value
            val waiting = Downloads.items.value.filter { it.status == Status.QUEUED && it.id !in jobs }.reversed()  // oldest first
            for (item in waiting) {
                if (jobs.size >= max) break
                jobs[item.id] = scope.launch { runOne(item) }
            }
            if (jobs.isEmpty() && Downloads.items.value.none { it.status == Status.QUEUED }) break
            Notifications.updateProgress(this, Downloads.items.value)
            delay(700)
        }
        finish()
    }

    private suspend fun runOne(start: DownloadItem) {
        val id = start.id
        val startedAt = System.currentTimeMillis()
        Downloads.update(id) { it.copy(status = Status.DOWNLOADING, error = null, phase = "Starting…", speedBps = 0, etaSec = null) }
        Log.i(TAG, "download start id=$id choice=${start.choiceKey} url=${start.url}")
        val tracker = ProgressTracker(start.parts)
        var lastPush = 0L
        var target: java.io.File? = null
        try {
            Engine.awaitNotUpdating()
            val dir = withContext(Dispatchers.IO) { Storage.dir() }
            target = if (start.kind == Kind.FILE) {
                val t = start.targetPath?.let { java.io.File(it) }
                    ?: withContext(Dispatchers.IO) { Storage.uniqueFile(dir, start.fileName ?: start.title) }
                if (start.targetPath == null) Downloads.update(id) { it.copy(targetPath = t.absolutePath) }
                t
            } else null
            val fileTarget = target
            withContext(Dispatchers.IO) {
                val request = Engine.downloadRequest(start, dir, fileTarget)
                if (stopRequests.containsKey(id)) throw IllegalStateException("stopped before start")
                YoutubeDL.getInstance().execute(request, id) { _, _, line ->
                    tracker.feed(line)
                    val now = System.currentTimeMillis()
                    if (now - lastPush > 400) {
                        lastPush = now
                        val s = tracker.snapshot()
                        Downloads.update(id, save = false) {
                            it.copy(
                                progress = s.progress, speedBps = s.speedBps, etaSec = s.etaSec, phase = s.phase,
                                sizeBytes = it.sizeBytes ?: s.totalBytes,
                            )
                        }
                    }
                }
            }
            val written = target
            val reported = tracker.outputPath()
            val output = withContext(Dispatchers.IO) {
                written?.takeIf { it.exists() }
                    ?: reported?.let { java.io.File(it) }?.takeIf { it.isFile }
                    ?: Storage.findOutput(start.mediaId, startedAt)
                    ?: Storage.findOutput(start.mediaId, 0)
            }
                ?: throw IllegalStateException("The download ended but the file was not found in ${Storage.LABEL}")
            Storage.scan(this, output.absolutePath)
            Downloads.update(id) {
                it.copy(
                    status = Status.DONE, progress = 100f, filePath = output.absolutePath, sizeBytes = output.length(),
                    speedBps = 0, etaSec = null, phase = null, error = null, finishedAt = System.currentTimeMillis(),
                )
            }
            Log.i(TAG, "download done id=$id path=${output.absolutePath} bytes=${output.length()}")
            Downloads.get(id)?.let { Notifications.finished(this, it) }
        } catch (e: CancellationException) {
            Downloads.update(id) { it.copy(status = Status.QUEUED, speedBps = 0, etaSec = null, phase = null) }
            throw e
        } catch (e: Throwable) {
            when (stopRequests[id]) {
                StopKind.REMOVE -> withContext(Dispatchers.IO) {
                    val path = target?.absolutePath ?: start.targetPath
                    Storage.cleanPartials(start.copy(targetPath = path), Downloads.items.value)
                }
                StopKind.PAUSE -> Downloads.update(id) { it.copy(status = Status.PAUSED, speedBps = 0, etaSec = null, phase = null) }
                null -> {
                    val message = cleanError(e.message ?: e.toString())
                    Log.w(TAG, "download failed id=$id error=$message")
                    Downloads.update(id) {
                        it.copy(status = Status.FAILED, error = message, speedBps = 0, etaSec = null, phase = null)
                    }
                    Downloads.get(id)?.let { Notifications.failed(this, it) }
                }
            }
        } finally {
            stopRequests.remove(id)
            jobs.remove(id)
        }
    }

    private fun finish() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        if (wakeLock?.isHeld == true) wakeLock?.release()
        stopSelf()
    }

    /** Android 15 limits background data work to 6 hours a day; pause politely when told to. */
    override fun onTimeout(startId: Int, fgsType: Int) {
        Log.w(TAG, "background time limit reached, pausing downloads")
        Downloads.pauseAll()
        finish()
    }

    override fun onDestroy() {
        for (id in jobs.keys.toList()) {
            Downloads.update(id) { it.copy(status = Status.QUEUED, speedBps = 0, etaSec = null, phase = null) }
            try { YoutubeDL.getInstance().destroyProcessById(id) } catch (_: Throwable) { }
        }
        scope.cancel()
        if (wakeLock?.isHeld == true) wakeLock?.release()
        super.onDestroy()
    }

    companion object {
        private val stopRequests = ConcurrentHashMap<String, StopKind>()

        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, DownloadService::class.java))
        }

        fun stop(id: String, remove: Boolean) {
            stopRequests[id] = if (remove) StopKind.REMOVE else StopKind.PAUSE
            try { YoutubeDL.getInstance().destroyProcessById(id) } catch (_: Throwable) { }
        }
    }
}
