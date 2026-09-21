package com.five.anarutas.driver

import java.security.GeneralSecurityException
import org.json.JSONException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DriverUiPolicyTest {
    @Test
    fun `route status messages do not invent an unknown server state`() {
        assertNull(routeStatusMessage("current"))
        assertEquals(
            "El recorrido cambió; espera que administración lo actualice.",
            routeStatusMessage("stale"),
        )
        assertEquals(
            "Administración todavía no ha calculado el recorrido.",
            routeStatusMessage("not_calculated"),
        )
        assertEquals(
            "La ruta no está lista. Consulta con administración.",
            routeStatusMessage("future_status"),
        )
    }

    @Test
    fun `api error messages preserve actionable server outcomes`() {
        assertEquals(
            "Datos incorrectos o celular no autorizado. Revisa el PIN y la activación.",
            friendlyError(DriverApiException(401, "MOBILE_LOGIN_INVALID")),
        )
        assertEquals(
            "La sesión terminó o fue revocada. Entra otra vez.",
            friendlyError(DriverApiException(401, "MOBILE_UNAUTHENTICATED")),
        )
        assertEquals(
            "Demasiados intentos. Espera antes de volver a probar.",
            friendlyError(DriverApiException(429, "TOO_MANY_ATTEMPTS")),
        )
        assertEquals(
            "El servidor rechazó la solicitud (500).",
            friendlyError(DriverApiException(500, "")),
        )
    }

    @Test
    fun `local failures are not mislabeled as connectivity failures`() {
        assertEquals(
            "La clave de este celular ya no está disponible. Solicita una nueva activación.",
            friendlyError(IllegalStateException("DEVICE_KEY_MISSING")),
        )
        assertEquals(
            "No se pudo abrir el acceso seguro del celular. Solicita una nueva activación.",
            friendlyError(GeneralSecurityException("keystore")),
        )
        assertEquals(
            "La respuesta del servidor no tiene el formato esperado. Avisa a administración.",
            friendlyError(JSONException("contract")),
        )
    }
}
