package com.five.anarutas.driver

import java.io.File
import java.nio.file.Files
import java.security.GeneralSecurityException
import org.json.JSONException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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
            "Esta camioneta todavía no tiene pedidos asignados.",
            routeStatusMessage("empty"),
        )
        assertEquals(
            "La ruta no está lista. Consulta con administración.",
            routeStatusMessage("future_status"),
        )
    }

    @Test
    fun `api error messages preserve actionable server outcomes`() {
        assertEquals(
            "Teléfono o PIN incorrectos. Verifica tus datos con administración.",
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
        assertEquals(
            "El servidor aún no tiene disponible esta función. Avisa a administración para actualizarlo.",
            friendlyError(DriverApiException(404, "")),
        )
        assertEquals(
            "Esta imagen ya se usó en otra ruta de la unidad. Toma una foto nueva.",
            friendlyError(DriverApiException(409, "UNIT_PHOTO_REUSED")),
        )
        assertEquals(
            "La ruta cambió desde que la abriste. Actualízala y confirma de nuevo.",
            friendlyError(DriverApiException(409, "VERSION_CONFLICT")),
        )
    }

    @Test
    fun `only a nonempty private camera file is accepted for unit photos`() {
        val cache = Files.createTempDirectory("ana-camera-test").toFile()
        try {
            val cameraDir = File(cache, "unit-camera").also { it.mkdir() }
            val valid = File(cameraDir, "unit-fresh.jpg").also { it.writeBytes(byteArrayOf(1, 2, 3)) }
            val empty = File(cameraDir, "unit-empty.jpg").also { it.createNewFile() }
            val gallery = File(cache, "gallery.jpg").also { it.writeBytes(byteArrayOf(1)) }
            val renamedGallery = File(cameraDir, "gallery.jpg").also { it.writeBytes(byteArrayOf(1)) }
            assertTrue(isPrivateCameraCapture(cache, valid))
            assertFalse(isPrivateCameraCapture(cache, empty))
            assertFalse(isPrivateCameraCapture(cache, gallery))
            assertFalse(isPrivateCameraCapture(cache, renamedGallery))
            assertFalse(isPrivateCameraCapture(cache, File(cameraDir, "unit-missing.jpg")))
        } finally {
            cache.deleteRecursively()
        }
    }

    @Test
    fun `local failures are not mislabeled as connectivity failures`() {
        assertEquals(
            "La clave segura de este celular ya no está disponible. Vuelve a ingresar con teléfono y PIN.",
            friendlyError(IllegalStateException("DEVICE_KEY_MISSING")),
        )
        assertEquals(
            "No se pudo abrir el acceso seguro del celular. Vuelve a ingresar con teléfono y PIN.",
            friendlyError(GeneralSecurityException("keystore")),
        )
        assertEquals(
            "La respuesta del servidor no tiene el formato esperado. Avisa a administración.",
            friendlyError(JSONException("contract")),
        )
    }

    @Test
    fun `only a revoked device or missing signing key triggers automatic reenrollment`() {
        assertTrue(canReenrollAfterChallengeFailure(DriverApiException(401, "MOBILE_LOGIN_INVALID")))
        assertTrue(canReenrollAfterChallengeFailure(IllegalStateException("DEVICE_KEY_MISSING")))
        assertFalse(canReenrollAfterChallengeFailure(DriverApiException(429, "TOO_MANY_ATTEMPTS")))
        assertFalse(canReenrollAfterChallengeFailure(DriverApiException(500, "")))
        assertFalse(canReenrollAfterChallengeFailure(IllegalStateException("OTHER_FAILURE")))
    }
}
