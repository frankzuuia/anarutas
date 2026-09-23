package com.five.anarutas.driver

internal const val MAX_NAVIGATION_WAYPOINTS = 25

internal fun hasValidNavigationPoint(order: DeliveryOrder): Boolean {
    val lat = order.latitude ?: return false
    val lon = order.longitude ?: return false
    return lat.isFinite() && lon.isFinite() && lat in -90.0..90.0 && lon in -180.0..180.0
}

internal fun navigationBatch(orders: List<DeliveryOrder>, startIndex: Int): List<DeliveryOrder> {
    if (startIndex !in orders.indices) return emptyList()
    return orders.drop(startIndex).take(MAX_NAVIGATION_WAYPOINTS)
}
