package com.five.anarutas.driver

internal enum class OrderServiceStatus(val wire: String, val label: String) {
    OPEN("open", "Abierto"), CLOSED_PENDING("closed_pending", "Pendiente de reintento"),
    REJECTED("rejected", "Rechazado"), RESCHEDULED("rescheduled", "Reprogramado · cerrado en esta ruta"),
    DELIVERED("delivered", "Entregado");
    companion object { fun parse(value: String) = entries.firstOrNull { it.wire == value } ?: error("UNKNOWN_ORDER_STATE") }
}
internal data class ExecutionOrderState(val shipmentId: String, val status: OrderServiceStatus, val version: Int)
internal fun serviceVisitReady(arrived: Boolean, visit: Int, closedVisit: Int) = arrived && visit > closedVisit
internal fun canDeliverOrder(status: OrderServiceStatus) = status in listOf(OrderServiceStatus.OPEN, OrderServiceStatus.CLOSED_PENDING, OrderServiceStatus.REJECTED)
internal fun canRejectOrder(status: OrderServiceStatus) = status in listOf(OrderServiceStatus.OPEN, OrderServiceStatus.CLOSED_PENDING)
internal fun canRescheduleOrder(status: OrderServiceStatus) = status == OrderServiceStatus.CLOSED_PENDING
internal fun ExecutionStop.hasPendingRetry() = orderStates.any { it.status == OrderServiceStatus.CLOSED_PENDING }
internal fun ExecutionStop.isServiceFinished() = orderStates.isNotEmpty() && orderStates.all { it.status in listOf(OrderServiceStatus.DELIVERED, OrderServiceStatus.RESCHEDULED) }
internal fun ExecutionStop.canAttend() = serviceVisitReady(arrivedAt != null, visitSequence, closedReportedVisitSequence) && !isServiceFinished()
