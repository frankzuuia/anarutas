package com.five.anarutas.driver

internal data class PreviewPoint(val latitude: Double, val longitude: Double)

/** Decodes the published Google Routes polyline without making a routing request. */
internal fun decodePreviewPolyline(encoded: String): List<PreviewPoint> {
    if (encoded.isEmpty() || encoded.length > 200_000) return emptyList()
    val points = ArrayList<PreviewPoint>()
    var cursor = 0
    var latitude = 0L
    var longitude = 0L
    fun component(): Long? {
        var value = 0L
        var shift = 0
        repeat(10) {
            if (cursor >= encoded.length) return null
            val digit = encoded[cursor++].code - 63
            if (digit !in 0..63) return null
            value = value or ((digit and 31).toLong() shl shift)
            if (digit < 32) return (value shr 1) xor -(value and 1L)
            shift += 5
        }
        return null
    }
    while (cursor < encoded.length) {
        if (points.size >= 5000) return emptyList()
        latitude += component() ?: return emptyList()
        longitude += component() ?: return emptyList()
        val lat = latitude / 100_000.0
        val lon = longitude / 100_000.0
        if (lat !in -90.0..90.0 || lon !in -180.0..180.0) return emptyList()
        points.add(PreviewPoint(lat, lon))
    }
    return points
}
