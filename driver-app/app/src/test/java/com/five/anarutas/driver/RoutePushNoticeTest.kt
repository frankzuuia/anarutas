package com.five.anarutas.driver

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RoutePushNoticeTest {
    @Test fun publishedRouteHasOnlyGenericContent() {
        assertEquals(
            RoutePushNotice("Nueva ruta disponible", "Tu ruta ya está lista. Abre Ana Rutas para verla."),
            routePushNotice("route_published"),
        )
    }

    @Test fun withdrawnRouteHasOnlyGenericContent() {
        assertEquals(
            RoutePushNotice("Ruta retirada", "Administración retiró tu ruta. Abre Ana Rutas para ver tu jornada."),
            routePushNotice("route_withdrawn"),
        )
    }

    @Test fun unrelatedEventIsIgnored() {
        assertNull(routePushNotice(null))
        assertNull(routePushNotice("incident_created"))
        assertNull(routePushNotice("route_published\ncustomer=private"))
    }
}
