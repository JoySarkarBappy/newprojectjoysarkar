package app.srot.android

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Environment
import android.webkit.CookieManager
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import java.io.File

/** Where finished files go (Download/Srot) and how to open, share and tidy them. */
object Storage {
    const val LABEL = "Download/Srot"

    fun dir(): File =
        File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Srot").also { it.mkdirs() }

    private val FINAL_SUFFIX = Regex("""^\.[A-Za-z0-9]{1,6}$""")

    /** "Title [id].mp4" is a finished file; "Title [id].f137.mp4" or ".mp4.part" are pieces. */
    fun isFinal(name: String, mediaId: String?): Boolean {
        if (name.endsWith(".part") || name.endsWith(".ytdl") || name.contains(".part-Frag")) return false
        if (mediaId == null) return true
        return FINAL_SUFFIX.matches(name.substringAfterLast("[$mediaId]"))
    }

    fun findOutput(mediaId: String?, startedAt: Long): File? =
        dir().listFiles()
            ?.filter { f ->
                f.isFile && (mediaId == null || f.name.contains("[$mediaId]")) &&
                    isFinal(f.name, mediaId) && f.lastModified() >= startedAt - 5_000
            }
            ?.maxByOrNull { it.lastModified() }

    /** A free name in the Srot folder: "notes.pdf", then "notes (1).pdf"... */
    fun uniqueFile(dir: File, name: String): File {
        val clean = InfoParser.safeName(name).ifEmpty { "download" }
        val dot = clean.lastIndexOf('.').takeIf { it > 0 } ?: clean.length
        val base = clean.substring(0, dot)
        val ext = clean.substring(dot)
        var n = 0
        while (true) {
            val f = File(dir, if (n == 0) clean else "$base ($n)$ext")
            if (!f.exists() && !File(f.path + ".part").exists()) return f
            n++
        }
    }

    /** Remove half-downloaded pieces of a cancelled download, unless another download of the same media still needs them. */
    fun cleanPartials(item: DownloadItem, others: List<DownloadItem>) {
        item.targetPath?.let { path ->
            File("$path.part").delete()
            File("$path.ytdl").delete()
            if (item.status != Status.DONE && others.none { it.filePath == path }) File(path).delete()
            return
        }
        val id = item.mediaId ?: return
        if (others.any { it.id != item.id && it.mediaId == id && it.isActive }) return
        val keep = others.mapNotNull { it.filePath }.toSet()
        dir().listFiles()
            ?.filter { it.name.contains("[$id]") && !isFinal(it.name, id) && it.absolutePath !in keep }
            ?.forEach { it.delete() }
    }

    fun deleteFile(context: Context, path: String) {
        File(path).delete()
        scan(context, path)
    }

    /** Let the gallery and music apps see (or forget) a file. */
    fun scan(context: Context, path: String) {
        MediaScannerConnection.scanFile(context.applicationContext, arrayOf(path), null, null)
    }

    fun mimeOf(file: File): String =
        MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase()) ?: "*/*"

    fun uriFor(context: Context, file: File): Uri =
        FileProvider.getUriForFile(context, "${context.packageName}.files", file)

    fun viewIntent(context: Context, path: String): Intent? {
        val file = File(path)
        if (!file.exists()) return null
        return Intent(Intent.ACTION_VIEW)
            .setDataAndType(uriFor(context, file), mimeOf(file))
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    /** Returns a message to show when the file cannot be opened, or null when it opened. */
    fun open(context: Context, path: String?): String? {
        val intent = path?.let { viewIntent(context, it) } ?: return "The file is no longer in $LABEL"
        return try {
            context.startActivity(intent)
            null
        } catch (e: ActivityNotFoundException) {
            "No app on this phone can open this kind of file"
        }
    }

    fun share(context: Context, path: String?): String? {
        val file = path?.let { File(it) }?.takeIf { it.exists() } ?: return "The file is no longer in $LABEL"
        val send = Intent(Intent.ACTION_SEND)
            .setType(mimeOf(file))
            .putExtra(Intent.EXTRA_STREAM, uriFor(context, file))
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return null
    }
}

/**
 * Pages opened in Srot's browser may need the user's sign-in (Instagram, Facebook...).
 * The browser's cookies for that site are written in the format yt-dlp reads.
 */
object Cookies {
    fun fileFor(context: Context, pageUrl: String): String? = try {
        write(context, pageUrl)
    } catch (e: Throwable) {
        null   // no WebView on this phone, or cookies unavailable: carry on without
    }

    private fun write(context: Context, pageUrl: String): String? {
        val host = Uri.parse(pageUrl).host ?: return null
        val youtube = host.endsWith("youtube.com") || host.endsWith("youtu.be")
        val raw = CookieManager.getInstance().getCookie(if (youtube) "https://www.youtube.com" else pageUrl)
        if (raw.isNullOrBlank()) return null
        // YouTube works best without cookies, unless the user signed in to get past its "are you a bot" check.
        if (youtube && !raw.contains("LOGIN_INFO=") && !raw.contains("SAPISID=")) return null
        val domain = if (youtube) "youtube.com" else host.split('.').takeLast(2).joinToString(".")
        val lines = raw.split(';').mapNotNull { part ->
            val i = part.indexOf('=')
            if (i <= 0) null
            else ".$domain\tTRUE\t/\tTRUE\t2147483647\t${part.substring(0, i).trim()}\t${part.substring(i + 1).trim()}"
        }
        if (lines.isEmpty()) return null
        val file = File(context.filesDir, "cookies/$domain.txt")
        file.parentFile?.mkdirs()
        file.writeText("# Netscape HTTP Cookie File\n" + lines.joinToString("\n") + "\n")
        return file.absolutePath
    }
}
