package app.srot.android

import java.util.Locale

/** Human-readable sizes, speeds and times. */
object Format {
    fun bytes(n: Long?): String {
        if (n == null || n <= 0) return ""
        if (n < 1024) return "$n B"
        val units = listOf("KB", "MB", "GB", "TB")
        var v = n / 1024.0
        var i = 0
        while (v >= 1024 && i < units.size - 1) { v /= 1024; i++ }
        val digits = when { v >= 100 -> 0; v >= 10 -> 1; else -> 2 }
        return String.format(Locale.US, "%.${digits}f %s", v, units[i])
    }

    fun speed(bps: Long): String = if (bps > 0) "${bytes(bps)}/s" else ""

    fun clock(totalSec: Long): String {
        val h = totalSec / 3600
        val m = (totalSec % 3600) / 60
        val s = totalSec % 60
        return if (h > 0) String.format(Locale.US, "%d:%02d:%02d", h, m, s) else String.format(Locale.US, "%d:%02d", m, s)
    }

    fun eta(sec: Long?): String = when {
        sec == null || sec < 0 -> ""
        sec < 60 -> "${sec}s left"
        sec < 3600 -> "${sec / 60}m ${sec % 60}s left"
        else -> "${sec / 3600}h ${(sec % 3600) / 60}m left"
    }

    fun statusLine(item: DownloadItem): String = when (item.status) {
        Status.QUEUED -> "Waiting · ${item.choiceLabel}"
        Status.DOWNLOADING -> {
            val parts = mutableListOf("${item.progress.toInt()}%")
            item.phase?.let { parts += it }
            speed(item.speedBps).takeIf { it.isNotEmpty() }?.let { parts += it }
            eta(item.etaSec).takeIf { it.isNotEmpty() }?.let { parts += it }
            parts.joinToString(" · ")
        }
        Status.PAUSED -> if (item.progress > 0) "Paused at ${item.progress.toInt()}% · ${item.choiceLabel}" else "Paused · ${item.choiceLabel}"
        Status.DONE -> listOf(item.choiceLabel, bytes(item.sizeBytes)).filter { it.isNotEmpty() }.joinToString(" · ")
        Status.FAILED -> item.error ?: "Failed"
    }
}
