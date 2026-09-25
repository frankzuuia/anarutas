package com.five.anarutas.driver

import android.content.Context
import androidx.core.content.edit

/** Presentation preferences only. Access credentials stay in DeviceCredentials. */
internal class DriverPreferences(context: Context) {
    private val store = context.getSharedPreferences("driver_preferences_v1", Context.MODE_PRIVATE)
    var keepRouteAwake: Boolean
        get() = store.getBoolean("keep_route_awake", false)
        set(value) { store.edit { putBoolean("keep_route_awake", value) } }
    val muteNavigationVoice: Boolean
        get() = store.getBoolean("mute_navigation_voice", false)
    fun saveMuteNavigationVoice(value: Boolean) = store.edit().putBoolean("mute_navigation_voice", value).commit()
    val needsNavigationNotice: Boolean
        get() = needsNavigationNotice(store.getInt("navigation_notice_version", 0))
    // Call off the main thread; a failed write must not be presented as saved.
    fun acknowledgeNavigationNotice() = store.edit().putInt("navigation_notice_version", NAVIGATION_NOTICE_VERSION).commit()
}
