package app.srot.android

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

object Notifications {
    private const val CHANNEL_PROGRESS = "progress"
    private const val CHANNEL_DONE = "done"
    const val PROGRESS_ID = 1

    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_PROGRESS, "Downloads in progress", NotificationManager.IMPORTANCE_LOW)
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_DONE, "Finished downloads", NotificationManager.IMPORTANCE_DEFAULT)
        )
    }

    private fun allowed(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun openApp(context: Context): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_OPEN, MainActivity.OPEN_DOWNLOADS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun progress(context: Context, items: List<DownloadItem>): Notification {
        val active = items.filter { it.status == Status.DOWNLOADING }
        val waiting = items.count { it.status == Status.QUEUED }
        val title = when {
            active.size == 1 -> active[0].title
            active.size > 1 -> "Downloading ${active.size} files"
            else -> "Getting ready to download"
        }
        val text = buildList {
            if (active.size == 1) add(Format.statusLine(active[0]))
            if (waiting > 0) add("$waiting waiting")
        }.joinToString(" · ")
        val percent = if (active.isEmpty()) 0 else active.map { it.progress }.average().toInt()
        return NotificationCompat.Builder(context, CHANNEL_PROGRESS)
            .setSmallIcon(R.drawable.ic_stat_srot)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(openApp(context))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setProgress(100, percent, active.isEmpty())
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    fun updateProgress(context: Context, items: List<DownloadItem>) {
        if (!allowed(context)) return
        context.getSystemService(NotificationManager::class.java).notify(PROGRESS_ID, progress(context, items))
    }

    fun finished(context: Context, item: DownloadItem) {
        if (!allowed(context)) return
        val open = item.filePath?.let { Storage.viewIntent(context, it) }
        val tap = if (open != null) {
            PendingIntent.getActivity(context, item.id.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        } else openApp(context)
        val n = NotificationCompat.Builder(context, CHANNEL_DONE)
            .setSmallIcon(R.drawable.ic_stat_srot)
            .setContentTitle("Download finished")
            .setContentText(item.title)
            .setSubText(item.choiceLabel)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .build()
        context.getSystemService(NotificationManager::class.java).notify(item.id.hashCode(), n)
    }

    fun failed(context: Context, item: DownloadItem) {
        if (!allowed(context)) return
        val n = NotificationCompat.Builder(context, CHANNEL_DONE)
            .setSmallIcon(R.drawable.ic_stat_srot)
            .setContentTitle("Download failed")
            .setContentText(item.title)
            .setStyle(NotificationCompat.BigTextStyle().bigText("${item.title}\n${item.error ?: ""}"))
            .setContentIntent(openApp(context))
            .setAutoCancel(true)
            .build()
        context.getSystemService(NotificationManager::class.java).notify(item.id.hashCode(), n)
    }
}
