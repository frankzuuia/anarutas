package com.five.anarutas.driver

internal enum class OrderServiceStatus(val wire: String, val label: String) {
    OPEN("open", "Abierto"), CLOSED_PENDING("closed_pending", "Pendiente de reintento"),
    REJECTED("rejected", "Rechazado"), RESCHEDULED("rescheduled", "Reprogramado · cerrado en esta ruta"),
    DELIVERED("delivered", "Entregado");
    companion object { fun parse(value: String) = entries.firstOrNull { it.wire == value } ?: error("UNKNOWN_ORDER_STATE") }
}
internal data class ExecutionOrderState(val shipmentId: String, val status: OrderServiceStatus, val version: Int,
    val paymentRequired: Boolean = false, val paymentConfirmed: Boolean = false)
internal fun serviceVisitReady(arrived: Boolean, visit: Int, closedVisit: Int) = arrived && visit > closedVisit
internal fun canDeliverOrder(status: OrderServiceStatus) = status in listOf(OrderServiceStatus.OPEN, OrderServiceStatus.CLOSED_PENDING, OrderServiceStatus.REJECTED)
internal fun canRejectOrder(status: OrderServiceStatus) = status in listOf(OrderServiceStatus.OPEN, OrderServiceStatus.CLOSED_PENDING)
internal fun canRescheduleOrder(status: OrderServiceStatus) = status == OrderServiceStatus.CLOSED_PENDING
internal fun canRescheduleRetry(status: OrderServiceStatus, visitSequence: Int, closedReportedVisitSequence: Int) =
    canRescheduleOrder(status) && closedReportedVisitSequence > 0 && visitSequence >= closedReportedVisitSequence
internal fun canRetryRescheduledOrder(status: OrderServiceStatus) = status == OrderServiceStatus.RESCHEDULED
internal fun ExecutionStop.hasPendingRetry() = orderStates.any { it.status == OrderServiceStatus.CLOSED_PENDING }
internal fun ExecutionStop.hasPendingCollection() = orderStates.any { it.status == OrderServiceStatus.DELIVERED && it.paymentRequired && !it.paymentConfirmed }
internal fun ExecutionStop.isServiceFinished() = orderStates.isNotEmpty() && !hasPendingCollection() && orderStates.all { it.status in listOf(OrderServiceStatus.DELIVERED, OrderServiceStatus.RESCHEDULED) }
internal fun ExecutionStop.canAttend() = serviceVisitReady(arrivedAt != null, visitSequence, closedReportedVisitSequence) && !isServiceFinished()
internal fun ExecutionStop.isVisibleOnMap() = point != null && !isServiceFinished()
internal fun ExecutionStop.serviceSummary(): String = when {
    hasPendingCollection() -> "Entrega con cobro pendiente"
    isServiceFinished() && orderStates.all { it.status == OrderServiceStatus.DELIVERED } -> "Entregada · fuera del mapa"
    isServiceFinished() -> "Reprogramada · puedes reintentar desde Pedido"
    hasPendingRetry() -> "Cliente cerrado · pendiente de reintento"
    arrivedAt != null -> "Llegada registrada"
    else -> address
}
