package app.srot.android

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Small user settings, kept in SharedPreferences. */
object Prefs {
    private lateinit var sp: SharedPreferences

    private val _theme = MutableStateFlow("system")
    /** "system", "light" or "dark". */
    val theme: StateFlow<String> = _theme

    private val _quality = MutableStateFlow("best")
    /** Quality pre-selected in the picker: "best", "1080", "720", "480", "360" or "mp3". */
    val quality: StateFlow<String> = _quality

    private val _maxConcurrent = MutableStateFlow(2)
    val maxConcurrent: StateFlow<Int> = _maxConcurrent

    private val _autoUpdate = MutableStateFlow(true)
    val autoUpdate: StateFlow<Boolean> = _autoUpdate

    fun init(context: Context) {
        sp = context.getSharedPreferences("srot", Context.MODE_PRIVATE)
        _theme.value = sp.getString("theme", "system") ?: "system"
        _quality.value = sp.getString("quality", "best") ?: "best"
        _maxConcurrent.value = sp.getInt("maxConcurrent", 2).coerceIn(1, 3)
        _autoUpdate.value = sp.getBoolean("autoUpdate", true)
    }

    fun setTheme(value: String) {
        if (value !in listOf("system", "light", "dark")) return
        _theme.value = value
        sp.edit().putString("theme", value).apply()
    }

    fun setQuality(value: String) {
        _quality.value = value
        sp.edit().putString("quality", value).apply()
    }

    fun setMaxConcurrent(value: Int) {
        val v = value.coerceIn(1, 3)
        _maxConcurrent.value = v
        sp.edit().putInt("maxConcurrent", v).apply()
    }

    fun setAutoUpdate(value: Boolean) {
        _autoUpdate.value = value
        sp.edit().putBoolean("autoUpdate", value).apply()
    }

    var lastEngineUpdate: Long
        get() = sp.getLong("lastEngineUpdate", 0L)
        set(value) = sp.edit().putLong("lastEngineUpdate", value).apply()

    var askedNotifications: Boolean
        get() = sp.getBoolean("askedNotifications", false)
        set(value) = sp.edit().putBoolean("askedNotifications", value).apply()
}
