package app.srot.android

import android.content.Context
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import org.json.JSONArray
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

/** The list of downloads, newest first, saved to the app's private storage. */
object Downloads {
    private lateinit var file: File
    private val _items = MutableStateFlow<List<DownloadItem>>(emptyList())
    val items: StateFlow<List<DownloadItem>> = _items

    /** One writer thread keeps saves in order. */
    private val writer = Executors.newSingleThreadExecutor()
    private val disk = Executors.newSingleThreadExecutor()

    fun load(context: Context) {
        file = File(context.filesDir, "downloads.json")
        val list = try {
            val arr = JSONArray(file.readText())
            (0 until arr.length()).mapNotNull { DownloadItem.fromJson(arr.getJSONObject(it)) }
        } catch (e: Exception) {
            emptyList()
        }
        // A download that was running when the app stopped carries on next time.
        _items.value = list.map {
            if (it.status == Status.DOWNLOADING) it.copy(status = Status.QUEUED, speedBps = 0, etaSec = null, phase = null) else it
        }
    }

    fun get(id: String): DownloadItem? = _items.value.firstOrNull { it.id == id }

    fun update(id: String, save: Boolean = true, change: (DownloadItem) -> DownloadItem) {
        _items.update { list -> list.map { if (it.id == id) change(it) else it } }
        if (save) save()
    }

    fun save() {
        val snapshot = _items.value
        writer.execute {
            try {
                val arr = JSONArray()
                snapshot.forEach { arr.put(it.toJson()) }
                val tmp = File(file.parentFile, "downloads.json.tmp")
                tmp.writeText(arr.toString())
                tmp.renameTo(file)
            } catch (e: Exception) {
                Log.e(TAG, "could not save the download list", e)
            }
        }
    }

    /** Returns false when the same thing is already in the list (it is resumed instead). */
    fun enqueue(context: Context, info: MediaInfo, choice: Choice): Boolean {
        val same = _items.value.firstOrNull { it.url == info.url && it.choiceKey == choice.key && it.status != Status.DONE }
        if (same != null) {
            if (same.status == Status.PAUSED || same.status == Status.FAILED) resume(context, same.id)
            return false
        }
        val item = DownloadItem(
            id = UUID.randomUUID().toString(),
            url = info.url,
            title = info.title,
            thumbnail = info.thumbnail,
            uploader = info.uploader,
            durationSec = info.durationSec,
            mediaId = info.id,
            kind = choice.kind,
            choiceKey = choice.key,
            choiceLabel = choice.label,
            parts = choice.parts,
            cookieFile = info.cookieFile,
            status = Status.QUEUED,
            sizeBytes = choice.sizeBytes,
            fileName = info.fileName,
            addedAt = System.currentTimeMillis(),
        )
        _items.update { listOf(item) + it }
        save()
        DownloadService.start(context)
        return true
    }

    fun pause(id: String) {
        when (get(id)?.status) {
            Status.QUEUED -> update(id) { it.copy(status = Status.PAUSED) }
            Status.DOWNLOADING -> DownloadService.stop(id, remove = false)
            else -> Unit
        }
    }

    fun resume(context: Context, id: String) {
        val item = get(id) ?: return
        if (item.status != Status.PAUSED && item.status != Status.FAILED) return
        update(id) { it.copy(status = Status.QUEUED, error = null, phase = null) }
        DownloadService.start(context)
    }

    fun pauseAll() = _items.value.filter { it.isActive }.forEach { pause(it.id) }

    fun remove(context: Context, id: String, deleteFile: Boolean) {
        val item = get(id) ?: return
        _items.update { list -> list.filterNot { it.id == id } }
        save()
        if (item.status == Status.DOWNLOADING) {
            DownloadService.stop(id, remove = true)       // the running job removes its pieces when it stops
        } else {
            disk.execute { Storage.cleanPartials(item, _items.value) }
        }
        val path = item.filePath
        if (deleteFile && path != null) disk.execute { Storage.deleteFile(context, path) }
    }

    fun clearFinished() {
        _items.update { list -> list.filterNot { it.status == Status.DONE } }
        save()
    }
}
