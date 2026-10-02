package com.five.anarutas.driver

import org.junit.Assert.*
import org.junit.Test

class CollectionContinuationPolicyTest {
    @Test fun acceptedPaymentReceiptKeepsRealIdentityAndMatchesOnlyItsOrderAndExecution() {
        val receipt = confirmedPaymentReceipt("payments", "execution", "shipment", "payment")!!
        assertEquals(ConfirmedPaymentReceipt("execution", "shipment", "payment"), receipt)
        assertEquals("payment", collectionPaymentId(receipt, "execution", "shipment"))
        assertNull(collectionPaymentId(receipt, "other", "shipment"))
        assertNull(collectionPaymentId(receipt, "execution", "other"))
        assertNull(collectionPaymentId(null, "execution", "shipment"))
    }

    @Test fun onlyAnIdentifiedAcceptedPaymentCanAnnounceCollection() {
        for (kind in listOf("requests", "work", "", "payment"))
            assertNull(confirmedPaymentReceipt(kind, "execution", "shipment", "payment"))
        for (blank in listOf("", " ", "\t")) {
            assertNull(confirmedPaymentReceipt("payments", blank, "shipment", "payment"))
            assertNull(confirmedPaymentReceipt("payments", "execution", blank, "payment"))
            assertNull(confirmedPaymentReceipt("payments", "execution", "shipment", blank))
        }
    }

    @Test fun failedOrIncoherentReadKeepsReceiptUntilVerifiedReadWithoutResending() {
        val effects = CollectionContinuationReceipts()
        val receipt = CollectionContinuationReceipt("execution", "stop", "payment")
        effects.confirm(receipt)
        repeat(3) { assertTrue(effects.consume("execution", verified = false).isEmpty()) }
        assertEquals(listOf(receipt), effects.consume("execution", verified = true))
        assertTrue(effects.consume("execution", verified = true).isEmpty())
    }

    @Test fun replayAndRecompositionDoNotAnnounceTheSamePaymentTwice() {
        val effects = CollectionContinuationReceipts()
        val receipt = CollectionContinuationReceipt("execution", "stop", "payment")
        effects.confirm(receipt)
        effects.confirm(receipt)
        effects.confirm(receipt.copy(stopId = "other-stop"))
        assertEquals(listOf(receipt), effects.consume("execution", true))
        effects.confirm(receipt)
        assertTrue(effects.consume("execution", true).isEmpty())
    }

    @Test fun changedExecutionDropsForeignReceiptsAndKeepsOrderOfAcceptedLocalEffects() {
        val effects = CollectionContinuationReceipts()
        val foreign = CollectionContinuationReceipt("old", "stop", "payment")
        val first = CollectionContinuationReceipt("current", "stop1", "payment")
        val second = CollectionContinuationReceipt("current", "stop2", "payment2")
        listOf(foreign, first, second).forEach(effects::confirm)
        assertEquals(listOf(first, second), effects.consume("current", true))
        assertTrue(effects.consume("old", true).isEmpty())
    }

    @Test fun retirementClearsPendingEffectsAndDeduplicationForNewSession() {
        val effects = CollectionContinuationReceipts()
        val receipt = CollectionContinuationReceipt("execution", "stop", "payment")
        effects.confirm(receipt)
        effects.clear()
        assertTrue(effects.consume("execution", true).isEmpty())
        effects.confirm(receipt)
        assertEquals(listOf(receipt), effects.consume("execution", true))
    }
}
