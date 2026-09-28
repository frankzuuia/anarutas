package com.five.anarutas.driver

import java.math.BigDecimal

internal enum class ProductIncidentKind(val wire: String, val label: String, val manual: Boolean) {
    SHORTAGE_VALIDATION("shortage_validation", "Faltante por validación", true),
    SHORTAGE_WAREHOUSE("shortage_warehouse", "Faltante desde bodega", true),
    REPLACEMENT_QUALITY("replacement_quality", "Reposición por calidad", false),
    REPLACEMENT_WRONG("replacement_wrong_product", "Reposición por producto erróneo", false),
    RETURN("return", "Devolución", false);
}
internal data class ProductIncidentRecord(val id: String, val shipmentId: String, val lineIndex: Int?,
    val kind: String, val product: String, val quantity: String, val unit: String, val status: String)
internal enum class WarehouseReason(val wire: String, val label: String) {
    SPECIAL("special", "Especiales"), QUALITY("quality", "Calidad"), LATE("late_arrival", "Llegada tardía")
}
internal fun productEvidenceRequired(kind: ProductIncidentKind) = !kind.manual

internal fun productQuantity(text: String): BigDecimal? {
    val normalized = text.trim().replace(',', '.')
    if (!Regex("\\d{1,12}(?:\\.\\d{1,6})?").matches(normalized)) return null
    return normalized.toBigDecimalOrNull()?.takeIf { it > BigDecimal.ZERO }
}
internal fun remainingProductQuantity(quantity: Double, incidents: List<ProductIncidentRecord>, shipmentId: String, lineIndex: Int): BigDecimal =
    BigDecimal.valueOf(quantity).subtract(incidents.filter { it.shipmentId == shipmentId && it.lineIndex == lineIndex }
        .fold(BigDecimal.ZERO) { total, incident -> total.add(BigDecimal(incident.quantity)) }).max(BigDecimal.ZERO)

internal fun productIncidentValid(kind: ProductIncidentKind, quantity: String, product: String, unit: String,
    remaining: BigDecimal?, note: String): Boolean {
    val amount = productQuantity(quantity) ?: return false
    if (note.length > 2000) return false
    if (kind.manual) return product.trim().isNotEmpty() && product.trim().length <= 300 &&
        unit.trim().isNotEmpty() && unit.trim().length <= 40 && (product + unit).none { it.code < 32 }
    return remaining != null && amount <= remaining
}
