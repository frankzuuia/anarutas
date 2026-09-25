package com.five.anarutas.driver

import org.json.JSONObject
import java.time.Instant
internal data class ExecutionStop(val id: String, val position: Int, val customer: String, val address: String,
    val shipmentIds: List<String>, val point: ExecutionPoint?, val version: Int,
    val customerLocationVersion: Int, val customerArchived: Boolean, val arrivedAt: String?)
internal data class DriverExecution(val id: String, val planId: String, val publicationRevision: Int, val revision: Int,
    val serverTime: Instant, val receivedElapsedMillis: Long, val timezone: String, val policy: ArrivalPolicy,
    val hasCorrections: Boolean, val stops: List<ExecutionStop>)
internal fun parseExecution(raw: String, receivedElapsed: Long): DriverExecution {
    val json = JSONObject(raw)
    val policy = json.getJSONObject("policy")
    val stops = json.getJSONArray("stops")
    return DriverExecution(json.getString("id"), json.getString("planId"), json.getInt("publicationRevision"), json.getInt("revision"),
        Instant.parse(json.getString("serverTime")), receivedElapsed, json.getString("timezone"),
        ArrivalPolicy(policy.getInt("radiusMeters"), policy.getInt("maxAccuracyMeters"), policy.getInt("maxSampleAgeSeconds"), policy.getInt("version")),
        json.getBoolean("hasCorrections"), (0 until stops.length()).map { index ->
            val s = stops.getJSONObject(index)
            val ids = s.getJSONArray("shipmentIds")
            ExecutionStop(s.getString("id"), s.getInt("position"), s.getString("customer"), s.getString("address"),
                (0 until ids.length()).map(ids::getString),
                if (s.isNull("latitude") || s.isNull("longitude")) null else ExecutionPoint(s.getDouble("latitude"), s.getDouble("longitude")),
                s.getInt("version"), s.getInt("customerLocationVersion"), s.getBoolean("customerArchived"),
                if (s.isNull("arrivedAt")) null else s.getString("arrivedAt"))
        })
}
internal fun stopCommand(execution: DriverExecution, stop: ExecutionStop, gps: DriverGps, elapsed: Long,
    commandId: String, corrected: ExecutionPoint?): JSONObject {
    // Align the sample's monotonic timestamp to the server clock. A slow response only makes it older.
    val capturedAt = sampleCapturedAt(execution.serverTime, execution.receivedElapsedMillis, gps.elapsedMillis)
    return JSONObject().put("commandId", commandId).put("executionId", execution.id)
        .put("publicationRevision", execution.publicationRevision).put("executionRevision", execution.revision)
        .put("stopVersion", stop.version).put("policyVersion", execution.policy.version)
        .put("sample", JSONObject().put("latitude", gps.point.latitude).put("longitude", gps.point.longitude)
            .put("accuracyMeters", gps.accuracy).put("ageMilliseconds", elapsed - gps.elapsedMillis)
            .put("capturedAt", capturedAt.toString()).put("mock", gps.mock)).apply {
            if (corrected != null) put("point", JSONObject().put("latitude", corrected.latitude).put("longitude", corrected.longitude))
                .put("customerLocationVersion", stop.customerLocationVersion)
        }
}
