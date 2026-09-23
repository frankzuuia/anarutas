package com.five.anarutas.driver

import android.content.Context
import androidx.core.content.edit

/** Presentation preferences only. Access credentials stay in DeviceCredentials. */
internal class DriverPreferences(context: Context) {
    private val store = context.getSharedPreferences("driver_preferences_v1", Context.MODE_PRIVATE)
    var keepRouteAwake: Boolean
        get() = store.getBoolean("keep_route_awake", false)
        set(value) { store.edit { putBoolean("keep_route_awake", value) } }
}
