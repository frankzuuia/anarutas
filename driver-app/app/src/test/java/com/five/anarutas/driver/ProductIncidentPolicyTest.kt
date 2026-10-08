package com.five.anarutas.driver

import java.math.BigDecimal
import org.junit.Assert.*
import org.junit.Test

class ProductIncidentPolicyTest {
    @Test fun formatsSavedQuantitiesWithoutRoundingOrTrailingZeros() {
        val examples = mapOf("2.000000" to "2", "5.0" to "5", "0.125000" to "0.125",
            "0.000001" to "0.000001", "1000.000000" to "1000", "999999999999.999999" to "999999999999.999999",
            "" to "", "sin cantidad" to "sin cantidad")
        for ((stored, visible) in examples) assertEquals(visible, productQuantityText(stored))
    }
    @Test fun eachKindOffersItsOwnCatalogWhileKeepingLegacyText() {
        assertEquals(listOf(ProductComment.MISSING, ProductComment.LATE), productCommentOptions(ProductIncidentKind.SHORTAGE_VALIDATION))
        assertEquals(listOf(ProductComment.MISSING), productCommentOptions(ProductIncidentKind.SHORTAGE_WAREHOUSE))
        for (kind in listOf(ProductIncidentKind.REPLACEMENT_QUALITY, ProductIncidentKind.REPLACEMENT_WRONG))
            assertEquals(listOf(ProductComment.SPECIAL, ProductComment.SPECIFICATIONS, ProductComment.QUANTITY, ProductComment.MISSING), productCommentOptions(kind))
        assertEquals(listOf(ProductComment.SPECIFICATIONS, ProductComment.QUALITY, ProductComment.DAMAGED), productCommentOptions(ProductIncidentKind.RETURN))
        assertEquals("Especiales\nNo venía el producto en el pedido\nNota original",
            productCommentsText(listOf("special", "product_not_ordered"), "Nota original"))
    }
    @Test fun photosAndClassificationUseExactSelectableOptions() {
        assertEquals(listOf("Operaciones", "Compras", "Ventas"), productDepartments)
        assertEquals(listOf("Especiales", "Reparto", "Picking", "Error en compra"), productConcepts)
        assertEquals(listOf("special", "quality", "late_arrival", "product_not_ordered"), WarehouseReason.entries.map { it.wire })
        assertEquals("No venía el producto en el pedido", WarehouseReason.MISSING.label)
        for (kind in ProductIncidentKind.entries) for (count in -1..4)
            assertEquals(count in (if (kind.manual) 0 else 1)..3, productPhotosValid(kind, count))
        assertEquals(7, ProductComment.entries.size)
        for (option in ProductComment.entries) assertEquals(option.label, productCommentsText(listOf(option.code), ""))
        assertEquals("Especiales\nNo venía el producto en el pedido\nNota adicional",
            productCommentsText(listOf("product_not_ordered", "special", "special"), "  Nota adicional  "))
        assertEquals("", productCommentsText(emptyList(), "   "))
        assertEquals("nota", productCommentsText(emptyList(), "nota"))
    }
    @Test fun classificationAndCommentValidationFollowKindWithoutChangingLegacyPhotoTransport() {
        for (kind in ProductIncidentKind.entries) {
            assertEquals(kind != ProductIncidentKind.RETURN, productClassificationRequired(kind))
            for (department in productDepartments + "") for (concept in productConcepts + "")
                assertEquals(kind == ProductIncidentKind.RETURN || department.isNotEmpty() && concept.isNotEmpty(),
                    productClassificationValid(kind, department, concept))
            for (comment in ProductComment.entries)
                assertEquals(comment in productCommentOptions(kind), productCommentsValid(kind, listOf(comment.code)))
            assertFalse(productCommentsValid(kind, listOf("unknown")))
            assertTrue(productCommentsValid(kind, emptyList()))
        }
        for (version in -1..4) assertEquals(version in 2..3, productUsesMultiplePhotos(version))
    }
    @Test fun requiresEvidenceForReplacementsAndReturnsOnly() {
        for (kind in ProductIncidentKind.entries) assertEquals(kind in setOf(ProductIncidentKind.REPLACEMENT_QUALITY,
            ProductIncidentKind.REPLACEMENT_WRONG, ProductIncidentKind.RETURN), productEvidenceRequired(kind))
    }
    @Test fun validatesQuantitiesAndPreservesDecimals() {
        for (input in listOf("", " ", "0", "-1", "NaN", "1e3", ".5", "1.", "1.0000001", "1000000000000")) assertNull(productQuantity(input))
        assertEquals(BigDecimal("0.25"), productQuantity("0,25"))
        assertEquals(BigDecimal("0.000001"), productQuantity(" 0.000001 "))
        assertEquals(BigDecimal("999999999999.999999"), productQuantity("999999999999.999999"))
    }
    @Test fun sentIncidentOnlyReturnsToSaveAfterAnActualEdit() {
        val sent = ProductIncidentRecord("i", "order", 0, "return", "Queso", "1.000000", "Unidades", "pending",
            department = "Ventas", concept = "Picking", comments = listOf("special"), additionalNote = "Nota")
        fun changed(quantity: String = "1", note: String = "Nota", comments: List<String> = listOf("special")) =
            productIncidentDraftChanged(sent, "return", "Queso", "Unidades", quantity, note, "", "Ventas", "Picking", comments)
        assertTrue(productIncidentDraftChanged(null, "return", "Queso", "Unidades", "1", "Nota", "", "Ventas", "Picking", emptyList()))
        assertFalse(changed())
        assertFalse(changed("1.0"))
        assertTrue(changed("0.5"))
        assertTrue(changed(note = "Otra nota"))
        assertTrue(changed(comments = emptyList()))
    }
    @Test fun sumsOnlyTheSameOrderAndLineIncludingResolvedIncidents() {
        val record = ProductIncidentRecord("1", "order", 0, "return", "Queso", "0.1", "kg", "pending")
        val records = listOf(record, record.copy(id = "2", quantity = "0.2", status = "resolved"),
            record.copy(id = "3", quantity = "0.5", status = "canceled"),
            record.copy(shipmentId = "other"), record.copy(lineIndex = 1), record.copy(lineIndex = null))
        assertEquals(0, BigDecimal("1.7").compareTo(remainingProductQuantity(2.0, records, "order", 0)))
        assertEquals(0, BigDecimal("1.8").compareTo(remainingProductQuantity(2.0, records, "order", 0, "1")))
        assertEquals(BigDecimal.ZERO, remainingProductQuantity(0.1, records, "order", 0))
        assertEquals(0, BigDecimal("2.0").compareTo(remainingProductQuantity(2.0, emptyList(), "order", 0)))
    }
    @Test fun editingManualShortageDoesNotLoseChangedProductUnitReasonOrClassification() {
        val saved = ProductIncidentRecord("manual", "order", null, "shortage_warehouse", "Chile", "1", "kg", "pending",
            department = "Compras", concept = "Error en compra", warehouseReason = "product_not_ordered")
        fun changed(kind: String = saved.kind, product: String = saved.product, unit: String = saved.unit,
            quantity: String = saved.quantity, department: String = saved.department, concept: String = saved.concept,
            reason: String = saved.warehouseReason) = productIncidentDraftChanged(saved, kind, product, unit, quantity, "", reason, department, concept, emptyList())
        assertFalse(changed())
        assertTrue(changed(kind = "shortage_validation"))
        assertTrue(changed(product = "Tomate"))
        assertTrue(changed(unit = "pieza"))
        assertTrue(changed(quantity = ""))
        assertTrue(changed(department = "Ventas"))
        assertTrue(changed(concept = "Picking"))
        assertTrue(changed(reason = "quality"))
    }
    @Test fun removingAClosedOrdersReportDoesNotRestoreDeliveredQuantities() {
        val closed = ProductIncidentRecord("closed", "order", 0, "return", "Queso", "1.000000", "kg", "resolved", reportRemoved = true)
        assertEquals(0, BigDecimal.ONE.compareTo(remainingProductQuantity(2.0, listOf(closed), "order", 0)))
        assertEquals(0, BigDecimal("2").compareTo(remainingProductQuantity(2.0, listOf(closed.copy(status = "canceled")), "order", 0)))
    }
    @Test fun manualProductsAndLineBasedReturnsHaveDifferentContracts() {
        for (kind in ProductIncidentKind.entries) {
            assertFalse(productIncidentValid(kind, "0", "Queso", "kg", BigDecimal.ONE, ""))
            assertFalse(productIncidentValid(kind, "1", "Queso", "kg", BigDecimal.ONE, "x".repeat(2001)))
            assertTrue(productIncidentValid(kind, "1", "Queso", "kg", BigDecimal.ONE, "x".repeat(2000)))
            if (kind.manual) {
                assertTrue(productIncidentValid(kind, "1", "x".repeat(300), "x".repeat(40), null, ""))
                for (product in listOf("", " ", "a\n", "x".repeat(301))) assertFalse(productIncidentValid(kind, "1", product, "kg", null, ""))
                for (unit in listOf("", " ", "a\n", "x".repeat(41))) assertFalse(productIncidentValid(kind, "1", "Queso", unit, null, ""))
            } else {
                assertFalse(productIncidentValid(kind, "1", "Queso", "kg", null, ""))
                assertFalse(productIncidentValid(kind, "1.000001", "Queso", "kg", BigDecimal.ONE, ""))
            }
        }
    }
}
