package com.five.anarutas.driver

import java.util.UUID

/** A 200 response alone is not the durable, authenticated incident receipt. */
internal fun confirmedIncidentReceipt(confirmed: Boolean, incidentId: String?): String? {
    if (!confirmed) return null
    val canonical = incidentId?.let { runCatching { UUID.fromString(it).toString() }.getOrNull() }
    check(canonical != null && canonical.equals(incidentId, ignoreCase = true)) { "Incidencia sin comprobante válido" }
    return canonical
}

/** Navigation consumes only a new durable receipt for this exact form after refresh has settled. */
internal fun productFormCloseConfirmed(state: ExecutionUiState, previousRevision: Int,
    stopId: String, shipmentId: String, editingIncidentId: String?): Boolean {
    if (!state.verified || state.busy || state.pending || state.retired || state.productRevision <= previousRevision) return false
    if (state.lastProductStopId != stopId || state.lastProductShipmentId != shipmentId) return false
    val incidentId = runCatching { confirmedIncidentReceipt(true, state.lastProductIncidentId) }.getOrNull() ?: return false
    return when (state.lastProductAction) {
        "product-incident" -> editingIncidentId == null
        "product-incident-amend", "product-incident-cancel" -> incidentId == editingIncidentId
        else -> false
    }
}
