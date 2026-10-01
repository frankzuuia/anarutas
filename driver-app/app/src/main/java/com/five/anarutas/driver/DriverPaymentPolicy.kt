package com.five.anarutas.driver

import java.math.BigDecimal

// Preview only. The server revalidates source revision, authorization and all amounts.
internal data class PaymentPreview(val tendered: BigDecimal, val change: BigDecimal, val received: BigDecimal, val balance: BigDecimal)

internal data class CollectionPreview(val tendered: BigDecimal, val cash: BigDecimal, val transfer: BigDecimal, val balance: BigDecimal)
internal fun collectionPaymentPreview(method: String, cashText: String, transferText: String, expectedText: String?, roundingText: String?): CollectionPreview? {
    if (method !in setOf("cash", "transfer", "credit", "mixed")) return null
    fun amount(text: String?): BigDecimal? = text?.takeIf { it.length <= 80 }?.toBigDecimalOrNull()
        ?.takeIf { it.precision() <= 32 && it.scale() in -24..56 && it.signum() >= 0 }
    val expected = amount(expectedText) ?: return null
    val rounding = amount(roundingText)?.takeIf { it.signum() > 0 } ?: return null
    val cash = when (method) { "cash" -> expected; "mixed" -> amount(cashText) ?: return null; else -> BigDecimal.ZERO }
    val transfer = when (method) { "transfer" -> expected; "mixed" -> amount(transferText) ?: return null; else -> BigDecimal.ZERO }
    if (listOf(expected, cash, transfer).any { it.remainder(rounding).signum() != 0 }) return null
    val received = cash.add(transfer)
    if (method == "mixed" && (cash.signum() <= 0 || transfer.signum() <= 0)) return null
    if (method != "credit" && received.compareTo(expected) != 0) return null
    return CollectionPreview(received, cash, transfer, expected.subtract(received))
}

// The current form captures the net receipt; historical receipts may still have change.
internal fun paymentCapturePreview(method: String, receivedText: String, expectedText: String?, roundingText: String?): PaymentPreview? =
    paymentPreview(method, receivedText, "0", expectedText, roundingText)

internal fun paymentPreview(method: String, tenderedText: String, changeText: String, expectedText: String?, roundingText: String?): PaymentPreview? {
    if (method !in setOf("cash", "transfer", "credit")) return null
    fun amount(text: String?): BigDecimal? = text?.takeIf { it.length <= 80 }?.toBigDecimalOrNull()
        ?.takeIf { it.precision() <= 32 && it.scale() in -24..56 && it.signum() >= 0 }
    val expected = amount(expectedText) ?: return null
    val rounding = amount(roundingText)?.takeIf { it.signum() > 0 } ?: return null
    val tendered = if (method == "credit") BigDecimal.ZERO else amount(tenderedText) ?: return null
    val change = if (method == "cash") amount(changeText) ?: return null else BigDecimal.ZERO
    if (listOf(expected, tendered, change).any { it.remainder(rounding).signum() != 0 }) return null
    val received = tendered.subtract(change)
    if (received.signum() < 0 || received > expected) return null
    val balance = expected.subtract(received)
    if (change.signum() != 0 && balance.signum() != 0) return null
    return PaymentPreview(tendered, change, received, balance)
}

internal fun financeCommandRetryable(status: Int): Boolean = status !in 400..499 || status == 401 || status == 408 || status == 429

internal data class FinanceReadTarget(val executionId: String?, val page: Int)
internal fun financeReadStillCurrent(requested: FinanceReadTarget, current: FinanceReadTarget, requestedDevice: String, currentDevice: String): Boolean =
    requested == current && requestedDevice == currentDevice
