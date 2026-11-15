package app.srot.android

import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min

/** Turns yt-dlp's `-J` output into the choices shown in the quality picker. */
object InfoParser {

    private class Fmt(
        val ext: String?,
        val height: Int?,
        val width: Int?,
        val vcodec: String?,
        val acodec: String?,
        val size: Long?,
        val tbr: Double,
    ) {
        /** yt-dlp's "res": the smaller side, so a 1080x1920 phone video counts as 1080p. */
        val res: Int? = if (height != null && width != null && width > 0) min(width, height) else height
        val hasVideo: Boolean = vcodec != "none" && ((height ?: 0) > 0 || (vcodec != null && vcodec != "none"))
        val audioOnly: Boolean = vcodec == "none" && acodec != null && acodec != "none"
        /** A missing audio codec on a video format usually means "has sound, not described". */
        val hasAudio: Boolean = (acodec != null && acodec != "none") || (acodec == null && hasVideo)
        val isH264: Boolean = vcodec?.startsWith("avc") == true || vcodec?.startsWith("h264") == true

        companion object {
            fun from(j: JSONObject) = Fmt(
                ext = j.str("ext"),
                height = if (j.has("height") && !j.isNull("height")) j.optInt("height") else null,
                width = if (j.has("width") && !j.isNull("width")) j.optInt("width") else null,
                vcodec = j.str("vcodec"),
                acodec = j.str("acodec"),
                size = j.long("filesize") ?: j.long("filesize_approx"),
                tbr = j.optDouble("tbr", 0.0).let { if (it.isNaN()) 0.0 else it },
            )
        }
    }

    fun parse(url: String, j: JSONObject, cookieFile: String? = null): MediaInfo {
        val type = j.str("_type") ?: "video"
        val isPlaylist = type == "playlist" || type == "multi_video"

        val formats = mutableListOf<Fmt>()
        j.optJSONArray("formats")?.let { arr ->
            for (i in 0 until arr.length()) arr.optJSONObject(i)?.let { formats += Fmt.from(it) }
        }
        if (formats.isEmpty() && !isPlaylist) formats += Fmt.from(j)     // single-format results describe themselves

        val video = formats.filter { it.hasVideo }
        val bestAudio = formats.filter { it.audioOnly }
            .sortedWith(compareByDescending<Fmt> { it.ext == "m4a" }.thenByDescending { it.tbr })
            .firstOrNull()
        val anyAudio = bestAudio != null || formats.any { it.acodec != null && it.acodec != "none" }

        val videoChoices = video.mapNotNull { it.res }.filter { it > 0 }.distinct().sortedDescending().take(7).map { res ->
            val pick = video.filter { it.res == res }
                .sortedWith(compareByDescending<Fmt> { it.isH264 && it.ext == "mp4" }.thenByDescending { it.tbr })
                .first()
            val needsAudio = !pick.hasAudio && bestAudio != null
            val size = when {
                pick.size == null -> null
                needsAudio -> bestAudio?.size?.let { it + pick.size }
                else -> pick.size
            }
            Choice(
                key = res.toString(),
                label = "${res}p",
                kind = Kind.VIDEO,
                sizeBytes = size,
                parts = if (needsAudio) 2 else 1,
                detail = qualityName(res),
            )
        }

        val audioChoices = if (anyAudio || videoChoices.isNotEmpty()) listOf(
            Choice("mp3", "MP3", Kind.AUDIO, bestAudio?.size, 1, "Music file, plays everywhere"),
            Choice("m4a", "M4A", Kind.AUDIO, bestAudio?.size, 1, "Original sound quality"),
        ) else emptyList()

        val isFile = videoChoices.isEmpty() && audioChoices.isEmpty() && !isPlaylist
        val fileName = if (isFile) fileNameFor(url, j) else null
        val fileExt = fileName?.substringAfterLast('.', "")?.lowercase()
        val directVideo = isFile && fileExt in VIDEO_EXTS
        val fileChoice = if (isFile) {
            val ext = fileName?.substringAfterLast('.', "")?.takeIf { it.isNotEmpty() && it.length <= 8 }
            Choice(
                key = "file",
                label = ext?.uppercase()?.let { "$it file" } ?: "File",
                kind = Kind.FILE,
                sizeBytes = j.long("filesize") ?: j.long("filesize_approx") ?: formats.firstNotNullOfOrNull { it.size },
                parts = 1,
            )
        } else null

        val thumbnail = j.str("thumbnail") ?: j.optJSONArray("thumbnails")?.let { arr ->
            (arr.length() - 1 downTo 0).firstNotNullOfOrNull { arr.optJSONObject(it)?.str("url") }
        }
        val duration = j.optDouble("duration", Double.NaN).takeIf { !it.isNaN() && it > 0 }?.toInt()

        return MediaInfo(
            url = url,
            id = j.str("id"),
            title = fileName ?: j.str("title") ?: j.str("id") ?: "Download",
            thumbnail = thumbnail,
            uploader = j.str("uploader") ?: j.str("channel") ?: j.str("uploader_id"),
            durationSec = duration,
            site = j.str("extractor_key"),
            isPlaylist = isPlaylist,
            videoChoices = if (isPlaylist) emptyList() else videoChoices,
            audioChoices = when {
                isPlaylist -> emptyList()
                directVideo -> listOf(Choice("mp3", "MP3", Kind.AUDIO, null, 1, "Only the sound of this video"))
                else -> audioChoices
            },
            fileChoice = fileChoice,
            cookieFile = cookieFile,
            fileName = fileName,
        )
    }

    private val EXT = Regex("""\.[A-Za-z0-9]{1,8}$""")
    private val VIDEO_EXTS = setOf("mp4", "m4v", "webm", "mkv", "mov", "avi", "flv", "3gp", "wmv", "ts")

    /** "https://x.org/files/Lecture%205.pdf?dl=1" -> "Lecture 5.pdf". Falls back to yt-dlp's title and type. */
    fun fileNameFor(url: String, j: JSONObject): String {
        val segment = url.substringBefore('#').substringBefore('?').trimEnd('/').substringAfterLast('/')
        val decoded = try {
            java.net.URLDecoder.decode(segment.replace("+", "%2B"), "UTF-8")
        } catch (e: Exception) {
            segment
        }
        val fromUrl = safeName(decoded)
        if (EXT.containsMatchIn(fromUrl)) return fromUrl
        val ext = (j.str("ext") ?: "").takeIf { it.isNotEmpty() && !it.startsWith("unknown") }
        val base = safeName(j.str("title") ?: fromUrl).ifEmpty { "download" }
        return if (ext != null && !base.endsWith(".$ext")) "$base.$ext" else base
    }

    /** No folders, and none of the characters phones or memory cards refuse. */
    fun safeName(name: String): String =
        name.replace(Regex("""[\\/:*?"<>|\u0000-\u001f]"""), "_").trim().trimStart('.').take(150)

    private fun qualityName(res: Int): String? = when {
        res >= 2160 -> "4K"
        res >= 1440 -> "2K"
        res >= 1080 -> "Full HD"
        res >= 720 -> "HD"
        else -> null
    }

    /** Index of the choice to pre-select for a saved preference ("best", "720", "mp3"...). */
    fun preferred(info: MediaInfo, pref: String): Choice? {
        val all = info.allChoices
        if (all.isEmpty()) return null
        if (pref == "mp3" || pref == "m4a") return info.audioChoices.firstOrNull { it.key == pref } ?: info.fileChoice ?: all.first()
        if (info.videoChoices.isEmpty()) return info.fileChoice ?: all.first()
        val want = pref.toIntOrNull() ?: return info.videoChoices.first()
        return info.videoChoices.firstOrNull { (it.key.toIntOrNull() ?: 0) <= want }
            ?: info.videoChoices.lastOrNull()
            ?: all.first()
    }
}

/** Reads yt-dlp's "[download]  45.2% of 120.50MiB at 2.35MiB/s ETA 00:31" lines. */
object ProgressLine {
    data class P(val percent: Float, val totalBytes: Long?, val speedBps: Long, val etaSec: Long?)

    private val RE = Regex(
        """\[download]\s+([\d.]+)%(?:\s+of\s+~?\s*([\d.]+)\s*([KMGTP]?i?B))?(?:\s+at\s+([\d.]+)\s*([KMGTP]?i?B)/s)?(?:\s+ETA\s+([\d:]+))?"""
    )

    fun parse(line: String): P? {
        val m = RE.find(line) ?: return null
        val g = m.groupValues
        val percent = g[1].toFloatOrNull() ?: return null
        val total = if (g[2].isNotEmpty()) bytes(g[2], g[3]) else null
        val speed = if (g[4].isNotEmpty()) bytes(g[4], g[5]) ?: 0L else 0L
        return P(percent.coerceIn(0f, 100f), total, speed, eta(g[6]))
    }

    fun bytes(number: String, unit: String): Long? {
        val n = number.toDoubleOrNull() ?: return null
        val base = if (unit.contains('i')) 1024.0 else 1000.0
        val power = when (unit.firstOrNull()) { 'K' -> 1; 'M' -> 2; 'G' -> 3; 'T' -> 4; 'P' -> 5; else -> 0 }
        return (n * Math.pow(base, power.toDouble())).toLong()
    }

    fun eta(text: String): Long? {
        if (text.isBlank()) return null
        return text.split(':').fold(0L) { acc, s -> acc * 60 + (s.toLongOrNull() ?: return null) }
    }
}

/** Follows one yt-dlp run and turns its output into one overall percentage. */
class ProgressTracker(expectedParts: Int) {
    data class Snapshot(val progress: Float, val speedBps: Long, val etaSec: Long?, val totalBytes: Long?, val phase: String?)

    private var parts = max(1, expectedParts)
    private var part = 0
    private var percent = 0f
    private var speed = 0L
    private var eta: Long? = null
    private var total: Long? = null
    private var processing: String? = null
    private var downloaded: String? = null
    private var merged: String? = null
    private var converted: String? = null

    /** The finished file as yt-dlp reported it: converted audio, else the merged video, else the downloaded file. */
    @Synchronized
    fun outputPath(): String? = converted ?: merged ?: downloaded

    @Synchronized
    fun feed(line: String) {
        val l = line.trim()
        when {
            l.startsWith("[download] Destination:") -> {
                downloaded = l.removePrefix("[download] Destination:").trim()
                part++
                if (part > parts) parts = part
                percent = 0f
                processing = null
            }
            l.startsWith("[Merger]") -> {
                processing = "Joining video and sound…"
                if (l.contains("into \"")) merged = l.substringAfter("into \"").removeSuffix("\"")
            }
            l.startsWith("[ExtractAudio]") -> {
                processing = "Converting the sound…"
                if (l.startsWith("[ExtractAudio] Destination:")) converted = l.removePrefix("[ExtractAudio] Destination:").trim()
                if (l.startsWith("[ExtractAudio] Not converting audio ")) {
                    converted = l.removePrefix("[ExtractAudio] Not converting audio ").substringBefore("; file is already").trim()
                }
            }
            l.startsWith("[Metadata]") || l.startsWith("[Fixup") || l.startsWith("[VideoConvertor]") ->
                processing = processing ?: "Finishing…"
            l.contains("has already been downloaded") -> {
                if (l.startsWith("[download] ")) {
                    downloaded = l.removePrefix("[download] ").substringBefore(" has already been downloaded").trim()
                }
                if (part == 0) part = 1
                percent = 100f
            }
            else -> ProgressLine.parse(l)?.let { p ->
                if (part == 0) part = 1
                percent = p.percent
                speed = p.speedBps
                eta = p.etaSec
                if (p.totalBytes != null && part == 1) total = p.totalBytes
                processing = null
            }
        }
    }

    @Synchronized
    fun snapshot(): Snapshot {
        val p = part.coerceAtLeast(1)
        val overall = when {
            parts <= 1 -> percent
            parts == 2 -> if (p == 1) percent * 0.85f else 85f + percent * 0.15f   // the picture is most of the bytes
            else -> ((p - 1) * 100f + percent) / parts
        }
        val phase = processing ?: when {
            parts == 2 && p == 1 -> "Downloading video"
            parts == 2 && p == 2 -> "Downloading sound"
            else -> null
        }
        val busy = processing != null
        return Snapshot(
            progress = min(overall, 99.5f),
            speedBps = if (busy) 0 else speed,
            etaSec = if (busy || parts > 1) null else eta,
            totalBytes = total,
            phase = phase,
        )
    }
}

/** Plain-language message from a yt-dlp failure. */
fun cleanError(message: String?): String {
    if (message.isNullOrBlank()) return "Something went wrong"
    val lines = message.lines().map { it.trim() }.filter { it.isNotEmpty() }
    val error = lines.lastOrNull { it.startsWith("ERROR:") } ?: lines.firstOrNull() ?: return "Something went wrong"
    if (message.contains("unable to obtain file audio codec")) return "This video has no sound, so there is nothing to save as audio"
    val text = error.removePrefix("ERROR:").trim()
        .replace(Regex("""^\[[^\]]+]\s*[^:\s]+:\s*"""), "")     // "[youtube] abc123: " prefix
        .replace(Regex("""\s*Use --cookies.*$"""), "")
    return text.take(300).ifBlank { "Something went wrong" }
}

/** First web link in some shared text ("Watch this! https://youtu.be/... via app"). */
fun firstUrl(text: String?): String? {
    if (text == null) return null
    val m = Regex("""https?://[^\s<>"']+""").find(text) ?: return null
    return m.value.trimEnd('.', ',', ';', '!', '?', ')', ']', '}', '>', '"', '\'')
}
