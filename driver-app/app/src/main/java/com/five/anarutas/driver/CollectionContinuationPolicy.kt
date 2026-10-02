package com.five.anarutas.driver

/** A UI receipt from an accepted payment response; never a command to send. */
internal data class ConfirmedPaymentReceipt(val executionId: String, val shipmentId: String, val paymentId: String)

internal fun confirmedPaymentReceipt(kind: String, executionId: String, shipmentId: String, paymentId: String): ConfirmedPaymentReceipt? =
    if (kind == "payments" && executionId.isNotBlank() && shipmentId.isNotBlank() && paymentId.isNotBlank())
        ConfirmedPaymentReceipt(executionId, shipmentId, paymentId) else null

internal fun collectionPaymentId(receipt: ConfirmedPaymentReceipt?, executionId: String, shipmentId: String): String? =
    receipt?.takeIf { it.executionId == executionId && it.shipmentId == shipmentId }?.paymentId

internal data class CollectionContinuationReceipt(val executionId: String, val stopId: String, val paymentId: String)

/** ViewModel-owned effects survive failed reads/rotation, without resending or persisting money. */
internal class CollectionContinuationReceipts {
    private val seen = mutableSetOf<Pair<String, String>>()
    private val pending = mutableListOf<CollectionContinuationReceipt>()

    fun confirm(receipt: CollectionContinuationReceipt) {
        if (!seen.add(receipt.executionId to receipt.paymentId)) return
        pending.add(receipt)
    }

    fun consume(executionId: String, verified: Boolean): List<CollectionContinuationReceipt> {
        if (!verified) return emptyList()
        val current = pending.filter { it.executionId == executionId }
        pending.clear()
        return current
    }

    fun clear() {
        pending.clear()
        seen.clear()
    }
}
