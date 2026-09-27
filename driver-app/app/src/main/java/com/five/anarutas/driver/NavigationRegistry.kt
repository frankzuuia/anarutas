package com.five.anarutas.driver

import com.google.android.libraries.navigation.Navigator

/** Keeps one SDK navigator alive only while guidance is active between app screens. */
internal object NavigationRegistry {
    private var active: Navigator? = null
    var destinationKey: String? = null
    private val eta = NavigationEtaState()
    private var settingDestination = false
    private var etaExecution: String? = null
    private var etaStop: String? = null
    private val rerouting = Navigator.ReroutingListener {
        if (!settingDestination) {
            val key = destinationKey
            val execution = etaExecution
            val stop = etaStop
            if (key != null && execution != null && stop != null) eta.begin(key, execution, stop)
        }
    }
    private val routeChanged = Navigator.RouteChangedListener {
        if (!settingDestination) destinationKey?.let(eta::ready)
    }
    val isGuidanceRunning: Boolean get() = active?.isGuidanceRunning == true

    fun attach(navigator: Navigator): Boolean {
        val previous = active
        if (previous != null && previous !== navigator) {
            if (previous.isGuidanceRunning) return false
            detachEta(previous)
            previous.cleanup()
            destinationKey = null
        }
        if (active !== navigator) {
            navigator.addReroutingListener(rerouting)
            navigator.addRouteChangedListener(routeChanged)
        }
        active = navigator
        return true
    }

    fun beginEta(key: String, execution: String, stop: String) {
        settingDestination = true; etaExecution = execution; etaStop = stop
        eta.begin(key, execution, stop)
    }
    fun confirmEta(key: String) { settingDestination = false; eta.ready(key) }
    fun clearEta() { settingDestination = false; etaExecution = null; etaStop = null; eta.clear() }
    fun estimate(execution: String?, stop: String?): NavigationEta? {
        val navigator = active
        val guiding = navigator?.isGuidanceRunning == true
        val seconds = if (guiding && !settingDestination) runCatching { navigator.currentTimeAndDistance?.seconds }.getOrNull() else null
        return eta.read(execution, stop, guiding, seconds)
    }
    private fun detachEta(navigator: Navigator) {
        navigator.removeReroutingListener(rerouting)
        navigator.removeRouteChangedListener(routeChanged)
        clearEta()
    }

    fun releaseIfInactive(navigator: Navigator?) {
        if (navigator == null || active !== navigator || navigator.isGuidanceRunning) return
        active = null
        destinationKey = null
        detachEta(navigator)
        navigator.cleanup()
    }

    fun endSession() {
        LiveTrackingService.stop()
        destinationKey = null
        clearEta()
        val navigator = active ?: return
        active = null
        detachEta(navigator)
        runCatching { navigator.stopGuidance() }
        runCatching { navigator.clearDestinations() }
        runCatching { navigator.cleanup() }
    }
}
