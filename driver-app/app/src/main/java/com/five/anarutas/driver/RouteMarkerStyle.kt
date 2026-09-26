package com.five.anarutas.driver

internal data class RouteMarkerStyle(val fill: String, val outline: String?, val text: String)

internal fun routeMarkerStyle(selected: Boolean, arrived: Boolean, pending: Boolean = false): RouteMarkerStyle = when {
    selected -> RouteMarkerStyle("#D0F58A", null, "#1D2B10")
    pending -> RouteMarkerStyle("#3B2D11", "#F5C766", "#FFDF95")
    arrived -> RouteMarkerStyle("#9BCDF6", "#E6F5FF", "#1D2B10")
    else -> RouteMarkerStyle("#30353C", "#D9E5DA", "#F4F5F1")
}
