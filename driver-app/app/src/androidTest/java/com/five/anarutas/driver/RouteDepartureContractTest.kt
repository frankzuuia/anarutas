package com.five.anarutas.driver

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Real Android JSON parser, no API or Navigator test double. */
@RunWith(AndroidJUnit4::class)
class RouteDepartureContractTest {
    private fun payload() = JSONObject("""{
        "plan":{"id":"plan","label":"Recorrido","serviceDate":"2026-09-29"},
        "vehicle":{"id":"unit","name":"Unidad","plate":""},
        "routeStatus":"current","orders":[],
        "publication":{"revision":4,"startedAt":"2026-09-29T13:00:00Z","photoCount":5}
    }""")

    @Test fun missingAndNullOptionalOriginPreserveLegacyParsing() {
        assertNull(parseAssignedPlan(payload()).departure)
        assertNull(parseAssignedPlan(payload()).completedAt)
        assertNull(parseAssignedPlan(payload().put("publication", payload().getJSONObject("publication").put("completedAt", JSONObject.NULL))).completedAt)
        assertNull(parseAssignedPlan(payload().put("departure", JSONObject.NULL)).departure)
    }

    @Test fun completionAndFinishCommandPreserveVersionedIdentityWithoutInventingAStop() {
        val completed = payload().put("publication", payload().getJSONObject("publication").put("completedAt", "2026-09-29T16:00:00Z"))
        assertEquals("2026-09-29T16:00:00Z", parseAssignedPlan(completed).completedAt)
        val execution = DriverExecution("execution", "plan", 4, 9, java.time.Instant.parse("2026-09-29T14:00:00Z"),
            1000, "America/Mexico_City", ArrivalPolicy(100, 50, 30, 2), false, emptyList())
        val warehouse = WarehouseDestination("execution", RouteDeparture("Bodega", 20.65, -103.42, 3))
        val command = routeFinishCommand(execution, warehouse, DriverGps(warehouse.point, 5.0, 1500, false), 1600, "command")
        assertEquals("execution", command.getString("executionId"))
        assertEquals(4, command.getInt("publicationRevision")); assertEquals(9, command.getInt("executionRevision"))
        assertEquals(3, command.getInt("depotVersion")); assertEquals(2, command.getInt("policyVersion"))
        assertTrue(command.getBoolean("confirmed")); assertFalse(command.has("stopId"))
        assertEquals(100, command.getJSONObject("sample").getLong("ageMilliseconds"))
        assertEquals("2026-09-29T14:00:00.500Z", command.getJSONObject("sample").getString("capturedAt"))
    }

    @Test fun optionalOriginUsesActualCoordinatesAddressAndVersion() {
        val json = payload().put("departure", JSONObject().put("address", "Punto de salida")
            .put("latitude", 20.65).put("longitude", -103.42).put("version", 3))
        assertEquals(RouteDeparture("Punto de salida", 20.65, -103.42, 3), parseAssignedPlan(json).departure)
        assertEquals(4, parseAssignedPlan(json).publicationRevision)
    }
}
