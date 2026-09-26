package com.five.anarutas.driver

internal data class RouteMarkerStyle(val fill: String, val outline: String?, val text: String)

internal fun routeMarkerStyle(selected: Boolean, arrived: Boolean, pending: Boolean = false): RouteMarkerStyle = when {
    pending -> RouteMarkerStyle("#F59E42", if (selected) "#FFF4DE" else "#FFD498", "#261505")
    selected -> RouteMarkerStyle("#D0F58A", null, "#1D2B10")
    arrived -> RouteMarkerStyle("#9BCDF6", "#E6F5FF", "#1D2B10")
    else -> RouteMarkerStyle("#30353C", "#D9E5DA", "#F4F5F1")
}
