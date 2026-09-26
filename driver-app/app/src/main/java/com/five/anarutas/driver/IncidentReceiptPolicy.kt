package com.five.anarutas.driver

import java.util.UUID

/** A 200 response alone is not the durable, authenticated incident receipt. */
internal fun confirmedIncidentReceipt(confirmed: Boolean, incidentId: String?): String? {
    if (!confirmed) return null
    val canonical = incidentId?.let { runCatching { UUID.fromString(it).toString() }.getOrNull() }
    check(canonical != null && canonical.equals(incidentId, ignoreCase = true)) { "Incidencia sin comprobante válido" }
    return canonical
}
