package com.five.anarutas.driver

/** Presentation metadata only. Selecting a card never submits a command. */
internal enum class IncidentChoice(val code: String, val label: String, val detail: String, val icon: DriverIcon) {
    SHORTAGE_VALIDATION("shortage_validation", "Faltante por validación", "Producto que faltó al revisar el pedido", DriverIcon.ALERT),
    SHORTAGE_WAREHOUSE("shortage_warehouse", "Faltante desde bodega", "Producto que no salió de bodega", DriverIcon.TRUCK),
    CUSTOMER_CLOSED("customer_closed", "Cliente cerrado", "Fotografía del negocio", DriverIcon.STORE_CLOSED),
    ORDER_REJECTED("reject", "Pedido rechazado", "Selecciona el motivo", DriverIcon.ORDER_REJECTED),
}

internal val arrivalIncidentChoices = listOf(IncidentChoice.CUSTOMER_CLOSED, IncidentChoice.ORDER_REJECTED)

internal fun incidentChoiceEnabled(choice: IncidentChoice, available: Boolean, hasRejectableOrders: Boolean): Boolean =
    available && (choice == IncidentChoice.CUSTOMER_CLOSED || hasRejectableOrders)

internal fun incidentNote(value: String): String = value.take(2000)
