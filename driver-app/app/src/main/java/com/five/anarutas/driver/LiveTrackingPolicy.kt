package com.five.anarutas.driver

internal fun trackingGps(gps: DriverGps?, now: Long, maximumAge: Long): DriverGps? = gps?.takeIf {
    !it.mock && it.point.latitude.isFinite() && it.point.longitude.isFinite() &&
        it.point.latitude in -90.0..90.0 && it.point.longitude in -180.0..180.0 &&
        it.accuracy.isFinite() && it.accuracy >= 0 && now - it.elapsedMillis in 0..maximumAge
}
internal fun trackingMustStop(status: Int) = status == 401 || status == 403 || status == 404 || status == 409
