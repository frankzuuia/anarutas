package com.five.anarutas.driver

import com.google.android.libraries.navigation.Navigator

/** Keeps one SDK navigator alive only while guidance is active between app screens. */
internal object NavigationRegistry {
    private var active: Navigator? = null

    fun attach(navigator: Navigator): Boolean {
        val previous = active
        if (previous != null && previous !== navigator) {
            if (previous.isGuidanceRunning) return false
            previous.cleanup()
        }
        active = navigator
        return true
    }

    fun releaseIfInactive(navigator: Navigator?) {
        if (navigator == null || active !== navigator || navigator.isGuidanceRunning) return
        active = null
        navigator.cleanup()
    }

    fun endSession() {
        val navigator = active ?: return
        active = null
        runCatching { navigator.stopGuidance() }
        runCatching { navigator.clearDestinations() }
        runCatching { navigator.cleanup() }
    }
}
