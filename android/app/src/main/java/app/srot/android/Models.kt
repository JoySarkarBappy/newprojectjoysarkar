package app.srot.android

import org.json.JSONObject

enum class Status { QUEUED, DOWNLOADING, PAUSED, DONE, FAILED }

enum class Kind { VIDEO, AUDIO, FILE }

/** One entry in the Downloads list. Immutable; the repository swaps in updated copies. */
data class DownloadItem(
    val id: String,
    val url: String,
    val title: String,
    val thumbnail: String?,
    val uploader: String?,
    val durationSec: Int?,
    /** yt-dlp's id for the media; every file Srot writes for it carries "[mediaId]" in its name. */
    val mediaId: String?,
    val kind: Kind,
    /** What to fetch: "best", a height such as "720", "mp3", "m4a" or "file". */
    val choiceKey: String,
    val choiceLabel: String,
    /** How many separate files yt-dlp downloads before merging (video + audio = 2). */
    val parts: Int,
    val cookieFile: String?,
    val status: Status,
    /** For plain files: the name taken from the link ("notes.pdf"). */
    val fileName: String? = null,
    /** For plain files: where the download is written, fixed on first start so a resume finds its piece. */
    val targetPath: String? = null,
    val progress: Float = 0f,
    val sizeBytes: Long? = null,
    val speedBps: Long = 0,
    val etaSec: Long? = null,
    val phase: String? = null,
    val filePath: String? = null,
    val error: String? = null,
    val addedAt: Long,
    val finishedAt: Long? = null,
) {
    val isActive: Boolean get() = status == Status.QUEUED || status == Status.DOWNLOADING

    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("url", url)
        put("title", title)
        putOpt("thumbnail", thumbnail)
        putOpt("uploader", uploader)
        putOpt("durationSec", durationSec)
        putOpt("mediaId", mediaId)
        put("kind", kind.name)
        put("choiceKey", choiceKey)
        put("choiceLabel", choiceLabel)
        put("parts", parts)
        putOpt("cookieFile", cookieFile)
        put("status", status.name)
        putOpt("fileName", fileName)
        putOpt("targetPath", targetPath)
        put("progress", progress.toDouble())
        putOpt("sizeBytes", sizeBytes)
        putOpt("filePath", filePath)
        putOpt("error", error)
        put("addedAt", addedAt)
        putOpt("finishedAt", finishedAt)
    }

    companion object {
        fun fromJson(j: JSONObject): DownloadItem? = try {
            DownloadItem(
                id = j.getString("id"),
                url = j.getString("url"),
                title = j.optString("title", "Download"),
                thumbnail = j.str("thumbnail"),
                uploader = j.str("uploader"),
                durationSec = if (j.has("durationSec")) j.optInt("durationSec") else null,
                mediaId = j.str("mediaId"),
                kind = Kind.valueOf(j.optString("kind", Kind.VIDEO.name)),
                choiceKey = j.optString("choiceKey", "best"),
                choiceLabel = j.optString("choiceLabel", ""),
                parts = j.optInt("parts", 1),
                cookieFile = j.str("cookieFile"),
                status = Status.valueOf(j.optString("status", Status.QUEUED.name)),
                fileName = j.str("fileName"),
                targetPath = j.str("targetPath"),
                progress = j.optDouble("progress", 0.0).toFloat(),
                sizeBytes = j.long("sizeBytes"),
                filePath = j.str("filePath"),
                error = j.str("error"),
                addedAt = j.optLong("addedAt", System.currentTimeMillis()),
                finishedAt = j.long("finishedAt"),
            )
        } catch (e: Exception) {
            null
        }
    }
}

/** A way to download what was analysed, shown as one row in the quality picker. */
data class Choice(
    val key: String,
    val label: String,
    val kind: Kind,
    val sizeBytes: Long?,
    val parts: Int,
    val detail: String? = null,
)

/** What yt-dlp found at a link. */
data class MediaInfo(
    val url: String,
    val id: String?,
    val title: String,
    val thumbnail: String?,
    val uploader: String?,
    val durationSec: Int?,
    val site: String?,
    val isPlaylist: Boolean,
    val videoChoices: List<Choice>,
    val audioChoices: List<Choice>,
    val fileChoice: Choice?,
    val cookieFile: String?,
    /** For plain files: the name to save under. */
    val fileName: String? = null,
) {
    val allChoices: List<Choice> get() = videoChoices + audioChoices + listOfNotNull(fileChoice)
}

/** JSON helpers: org.json turns missing values into "" or 0, these return null instead. */
fun JSONObject.str(key: String): String? =
    if (has(key) && !isNull(key)) optString(key).takeIf { it.isNotBlank() } else null

fun JSONObject.long(key: String): Long? =
    if (has(key) && !isNull(key)) optDouble(key, Double.NaN).takeIf { !it.isNaN() && it > 0 }?.toLong() else null
