package com.five.anarutas.driver

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NavigationPolicyTest {
    private fun order(index: Int, latitude: Double? = 20.67, longitude: Double? = -103.35) = DeliveryOrder(
        id = "order-$index", name = "SO$index", customer = "Cliente $index", address = "Punto $index",
        position = index, eta = null, phone = null, note = "", lines = emptyList(),
        latitude = latitude, longitude = longitude,
    )

    @Test fun `rejects missing and non-finite points before paid navigation`() {
        assertFalse(hasValidNavigationPoint(order(1, null)))
        assertFalse(hasValidNavigationPoint(order(1, longitude = null)))
        assertFalse(hasValidNavigationPoint(order(1, latitude = Double.NaN)))
        assertFalse(hasValidNavigationPoint(order(1, longitude = Double.POSITIVE_INFINITY)))
        assertFalse(hasValidNavigationPoint(order(1, latitude = 90.1)))
        assertFalse(hasValidNavigationPoint(order(1, longitude = -180.1)))
        assertTrue(hasValidNavigationPoint(order(1)))
    }

    @Test fun `sends at most twenty five destinations and retains remaining stops`() {
        val orders = (1..51).map(::order)
        assertEquals(25, navigationBatch(orders, 0).size)
        assertEquals("order-26", navigationBatch(orders, 25).first().id)
        assertEquals(25, navigationBatch(orders, 25).size)
        assertEquals("order-51", navigationBatch(orders, 50).single().id)
        assertTrue(navigationBatch(orders, 51).isEmpty())
        assertTrue(navigationBatch(orders, -1).isEmpty())
    }
}
