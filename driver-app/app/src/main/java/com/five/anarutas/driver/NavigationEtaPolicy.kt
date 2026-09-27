package com.five.anarutas.driver

internal data class NavigationEta(val targetStopId: String, val state: String, val remainingSeconds: Int?)

/** Destination fence, independent of Activity lifecycle. No estimate is extrapolated. */
internal class NavigationEtaState {
    private var key: String? = null
    private var executionId: String? = null
    private var stopId: String? = null
    private var calculating = false

    fun begin(destinationKey: String, execution: String, stop: String) {
        key = destinationKey; executionId = execution; stopId = stop; calculating = true
    }
    fun ready(destinationKey: String) {
        if (key == destinationKey) calculating = false
    }
    fun clear() { key = null; executionId = null; stopId = null; calculating = false }
    fun read(execution: String?, stop: String?, guiding: Boolean, seconds: Int?): NavigationEta? {
        if (stop == null || execution != executionId || stop != stopId) return null
        if (calculating) return NavigationEta(stop, "calculating", null)
        if (!guiding || seconds == null || seconds < 0) return NavigationEta(stop, "unavailable", null)
        return NavigationEta(stop, "ready", seconds)
    }
}

internal fun navigationEtaLabel(eta: NavigationEta?, arrived: Boolean, freshGps: Boolean): String {
    if (arrived) return "En atención"
    if (eta == null) return "Sin destino activo"
    if (!freshGps) return "Tiempo desactualizado"
    if (eta.state == "calculating") return "Calculando…"
    val seconds = eta.remainingSeconds
    if (eta.state != "ready" || seconds == null) return "Tiempo no disponible"
    return if (seconds < 60) "<1 min" else "≈${(seconds.toLong() + 59) / 60} min"
}
