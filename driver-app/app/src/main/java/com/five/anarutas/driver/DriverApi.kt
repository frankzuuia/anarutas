package com.five.anarutas.driver

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.io.InputStream
import java.io.IOException

data class DriverSession(val driverId: String, val deviceId: String, val token: String)
data class DeviceChallenge(val id: String, val nonce: String)
data class PlanSummary(
    val id: String,
    val label: String,
    val date: String,
    val vehicle: String,
    val orderCount: Int,
)
data class DeliveryLine(val name: String, val quantity: Double, val unit: String)
data class DeliveryOrder(
    val id: String,
    val name: String,
    val customer: String,
    val address: String,
    val position: Int,
    val eta: String?,
    val phone: String?,
    val note: String,
    val lines: List<DeliveryLine>,
)
data class AssignedPlan(
    val label: String,
    val date: String,
    val vehicle: String,
    val routeStatus: String,
    val orders: List<DeliveryOrder>,
)

class DriverApiException(val status: Int, val code: String) : Exception(code)

class DriverApi(private val server: String) {
    private fun InputStream.readLimited(): String =
        bufferedReader(StandardCharsets.UTF_8).use { reader ->
            val result = StringBuilder()
            val chunk = CharArray(8192)
            while (true) {
                val count = reader.read(chunk)
                if (count < 0) break
                if (result.length + count > 2_000_000) throw IOException("RESPONSE_TOO_LARGE")
                result.append(chunk, 0, count)
            }
            result.toString()
        }

    private suspend fun exchange(
        method: String,
        path: String,
        token: String? = null,
        payload: JSONObject? = null,
    ): String = withContext(Dispatchers.IO) {
        val connection = (URL("$server$path").openConnection() as HttpURLConnection)
        try {
            connection.requestMethod = method
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 10000
            connection.readTimeout = 15000
            connection.setRequestProperty("Accept", "application/json")
            if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
            if (payload != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use {
                    it.write(payload.toString().toByteArray(StandardCharsets.UTF_8))
                }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.readLimited() ?: ""
            if (status !in 200..299) {
                val code = runCatching { JSONObject(text).optString("error") }.getOrDefault("")
                throw DriverApiException(status, code)
            }
            text
        } finally {
            connection.disconnect()
        }
    }

    suspend fun enroll(phone: String, pin: String, code: String, publicKey: String): DriverSession {
        val response = JSONObject(exchange("POST", "/api/mobile/enroll", payload = JSONObject()
            .put("phone", phone).put("pin", pin).put("code", code).put("publicKey", publicKey)))
        return DriverSession(response.getString("driverId"), response.getString("deviceId"), response.getString("token"))
    }

    suspend fun challenge(phone: String, deviceId: String): DeviceChallenge {
        val response = JSONObject(exchange("POST", "/api/mobile/challenge", payload = JSONObject()
            .put("phone", phone).put("deviceId", deviceId)))
        return DeviceChallenge(response.getString("challengeId"), response.getString("nonce"))
    }

    suspend fun login(
        phone: String,
        pin: String,
        deviceId: String,
        challenge: DeviceChallenge,
        signature: String,
    ): DriverSession {
        val response = JSONObject(exchange("POST", "/api/mobile/session", payload = JSONObject()
            .put("phone", phone).put("pin", pin).put("deviceId", deviceId)
            .put("challengeId", challenge.id).put("nonce", challenge.nonce)
            .put("signature", signature)))
        return DriverSession(response.getString("driverId"), response.getString("deviceId"), response.getString("token"))
    }

    suspend fun logout(token: String) {
        exchange("DELETE", "/api/mobile/session", token)
    }

    suspend fun plans(token: String): List<PlanSummary> {
        val response = JSONArray(exchange("GET", "/api/mobile/plans", token))
        return (0 until response.length()).map { index ->
            val item = response.getJSONObject(index)
            PlanSummary(
                id = item.getString("id"),
                label = item.getString("label"),
                date = item.getString("service_date"),
                vehicle = item.getString("vehicle_name"),
                orderCount = item.getInt("orders"),
            )
        }
    }

    suspend fun plan(token: String, planId: String): AssignedPlan {
        val response = JSONObject(exchange("GET", "/api/mobile/plans/$planId", token))
        val plan = response.getJSONObject("plan")
        val vehicle = response.getJSONObject("vehicle")
        val etaByShipment = mutableMapOf<String, Pair<Int, String?>>()
        response.optJSONObject("route")?.optJSONArray("stops")?.let { stops ->
            for (index in 0 until stops.length()) {
                val stop = stops.getJSONObject(index)
                etaByShipment[stop.getString("shipmentId")] =
                    stop.getInt("position") to
                    (if (stop.isNull("eta")) null else stop.optString("eta").takeIf { it.isNotBlank() })
            }
        }
        val orders = response.getJSONArray("orders")
        val parsed = (0 until orders.length()).map { index ->
            val item = orders.getJSONObject(index)
            val id = item.getString("id")
            val lines = item.getJSONArray("lines")
            DeliveryOrder(
                id = id,
                name = item.getString("orderName"),
                customer = item.getString("customerName"),
                address = item.getString("address"),
                position = etaByShipment[id]?.first ?: item.getInt("position"),
                eta = etaByShipment[id]?.second,
                phone = if (item.isNull("phone")) null else item.optString("phone").takeIf { it.isNotBlank() },
                note = if (item.isNull("deliveryNote")) "" else item.optString("deliveryNote"),
                lines = (0 until lines.length()).map { lineIndex ->
                    val line = lines.getJSONObject(lineIndex)
                    DeliveryLine(line.getString("name"), line.getDouble("quantity"), line.getString("unit"))
                },
            )
        }.sortedWith(compareBy<DeliveryOrder> { it.position }.thenBy { it.name })
        return AssignedPlan(
            label = plan.getString("label"),
            date = plan.getString("serviceDate"),
            vehicle = vehicle.getString("name"),
            routeStatus = response.getString("routeStatus"),
            orders = parsed,
        )
    }
}
