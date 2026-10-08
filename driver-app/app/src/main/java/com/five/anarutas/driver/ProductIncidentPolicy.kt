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
    val kind: String, val product: String, val quantity: String, val unit: String, val status: String,
    val version: Int = 1, val department: String = "", val concept: String = "", val warehouseReason: String = "",
    val comments: List<String> = emptyList(), val additionalNote: String = "", val evidenceCount: Int = 0,
    val reportRemoved: Boolean = false, val financial: IncidentFinancialReference? = null, val replacementPayment: String? = null)
internal enum class WarehouseReason(val wire: String, val label: String) {
    SPECIAL("special", "Especiales"), QUALITY("quality", "Calidad"), LATE("late_arrival", "Llegada tardía"),
    MISSING("product_not_ordered", "No venía el producto en el pedido")
}
internal fun productEvidenceRequired(kind: ProductIncidentKind) = !kind.manual
internal val productDepartments = listOf("Operaciones", "Compras", "Ventas")
internal val productConcepts = listOf("Especiales", "Reparto", "Picking", "Error en compra")
internal enum class ProductComment(val code: String, val label: String) {
    SPECIAL("special", "Especiales"),
    SPECIFICATIONS("customer_specifications", "No cumple con las especificaciones del cliente"),
    QUANTITY("order_quantity_changed", "Se modificó la cantidad en la orden"),
    MISSING("product_not_ordered", "No venía el producto en el pedido"),
    LATE("late_arrival", "Llegada tardía"),
    QUALITY("poor_quality", "Mala calidad"),
    DAMAGED("damaged_product", "Producto golpeado"),
}
internal fun productCommentOptions(kind: ProductIncidentKind): List<ProductComment> =
    when (kind) {
        ProductIncidentKind.SHORTAGE_VALIDATION -> listOf(ProductComment.MISSING, ProductComment.LATE)
        ProductIncidentKind.SHORTAGE_WAREHOUSE -> listOf(ProductComment.MISSING)
        ProductIncidentKind.REPLACEMENT_QUALITY, ProductIncidentKind.REPLACEMENT_WRONG ->
            listOf(ProductComment.SPECIAL, ProductComment.SPECIFICATIONS, ProductComment.QUANTITY, ProductComment.MISSING)
        ProductIncidentKind.RETURN -> listOf(ProductComment.SPECIFICATIONS, ProductComment.QUALITY, ProductComment.DAMAGED)
    }
internal fun productClassificationRequired(kind: ProductIncidentKind) = kind != ProductIncidentKind.RETURN
internal fun productClassificationValid(kind: ProductIncidentKind, department: String, concept: String) =
    !productClassificationRequired(kind) || department in productDepartments && concept in productConcepts
internal fun productCommentsValid(kind: ProductIncidentKind, comments: List<String>) =
    comments.all { code -> productCommentOptions(kind).any { it.code == code } }
internal fun productUsesMultiplePhotos(formVersion: Int) = formVersion == 2 || formVersion == 3
internal fun productQuantityText(value: String): String =
    value.toBigDecimalOrNull()?.stripTrailingZeros()?.toPlainString() ?: value
internal fun productPhotosValid(kind: ProductIncidentKind, count: Int) = count in (if (productEvidenceRequired(kind)) 1 else 0)..3
internal fun productCommentsText(selected: List<String>, note: String) =
    (ProductComment.entries.filter { it.code in selected }.map { it.label } + note.trim()).filter { it.isNotBlank() }.joinToString("\n")

internal fun productIncidentDraftChanged(saved: ProductIncidentRecord?, kindCode: String, product: String,
    unit: String, quantity: String, note: String, warehouseReason: String, department: String,
    concept: String, comments: List<String>): Boolean {
    if (saved == null) return true
    return kindCode != saved.kind || productQuantity(quantity)?.compareTo(productQuantity(saved.quantity)) != 0 ||
        (saved.lineIndex == null && (product != saved.product || unit != saved.unit)) ||
        note != saved.additionalNote || department != saved.department || concept != saved.concept ||
        comments.toSet() != saved.comments.toSet() ||
        (if (kindCode == ProductIncidentKind.SHORTAGE_WAREHOUSE.wire) warehouseReason else "") != saved.warehouseReason
}

internal fun productQuantity(text: String): BigDecimal? {
    val normalized = text.trim().replace(',', '.')
    if (!Regex("\\d{1,12}(?:\\.\\d{1,6})?").matches(normalized)) return null
    return normalized.toBigDecimalOrNull()?.takeIf { it > BigDecimal.ZERO }
}
internal fun remainingProductQuantity(quantity: Double, incidents: List<ProductIncidentRecord>, shipmentId: String, lineIndex: Int,
    exceptId: String? = null): BigDecimal =
    remainingProductQuantity(BigDecimal.valueOf(quantity), incidents, shipmentId, lineIndex, exceptId)
internal fun remainingProductQuantity(quantity: BigDecimal, incidents: List<ProductIncidentRecord>, shipmentId: String, lineIndex: Int,
    exceptId: String? = null): BigDecimal =
    quantity.subtract(incidents.filter { it.shipmentId == shipmentId && it.lineIndex == lineIndex &&
        it.status != "canceled" && it.id != exceptId }
        .fold(BigDecimal.ZERO) { total, incident -> total.add(BigDecimal(incident.quantity)) }).max(BigDecimal.ZERO)

internal fun productIncidentValid(kind: ProductIncidentKind, quantity: String, product: String, unit: String,
    remaining: BigDecimal?, note: String, linked: Boolean = !kind.manual): Boolean {
    val amount = productQuantity(quantity) ?: return false
    if (note.length > 2000) return false
    if (!linked) return product.trim().isNotEmpty() && product.trim().length <= 300 &&
        unit.trim().isNotEmpty() && unit.trim().length <= 40 && (product + unit).none { it.code < 32 }
    return remaining != null && amount <= remaining
}
