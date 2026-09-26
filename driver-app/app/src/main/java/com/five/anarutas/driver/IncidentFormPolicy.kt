package com.five.anarutas.driver

/** Presentation metadata only. Selecting a card never submits a command. */
internal enum class IncidentChoice(val code: String, val label: String, val detail: String, val icon: DriverIcon) {
    CUSTOMER_CLOSED("customer_closed", "Cliente cerrado", "Fotografía del negocio", DriverIcon.STORE_CLOSED),
    ORDER_REJECTED("reject", "Pedido rechazado", "Selecciona el motivo", DriverIcon.ORDER_REJECTED),
}

internal fun incidentChoiceEnabled(choice: IncidentChoice, available: Boolean, hasRejectableOrders: Boolean): Boolean =
    available && (choice != IncidentChoice.ORDER_REJECTED || hasRejectableOrders)

internal fun incidentNote(value: String): String = value.take(2000)
