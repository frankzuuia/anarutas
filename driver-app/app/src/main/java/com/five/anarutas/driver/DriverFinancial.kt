package com.five.anarutas.driver

import org.json.JSONObject
import java.math.BigDecimal
import java.text.NumberFormat
import java.time.Duration
import java.time.Instant
import java.util.Locale

data class IncidentFinancialReference(val revision: Int, val moveId: Long, val saleLineId: Long) {
    fun json(): JSONObject = JSONObject().put("revision", revision).put("moveId", moveId).put("saleLineId", saleLineId)
    val key: String get() = "$revision:$moveId:$saleLineId"
}
data class DriverCurrency(val name: String, val decimalPlaces: Int, val rounding: String? = null)
data class DriverFinancialLine(val lineIndex: Int, val moveId: Long, val saleLineId: Long,
    val quantity: String, val unit: String, val unitPrice: String, val discount: String,
    val total: String, val physicalRemaining: String, val net: String?, val deduction: String?, val deferred: String?)
data class DriverFinancialTotals(val original: String, val deduction: String, val deferred: String,
    val net: String, val roundingAdjustment: String, val remainingRoundingAdjustment: String)
data class DriverFinancialView(val revision: Int, val status: String, val fresh: Boolean, val error: String?,
    val checkedAt: Instant?, val serverTime: Instant, val maxAgeSeconds: Long, val receivedNanos: Long,
    val currency: DriverCurrency?, val lines: List<DriverFinancialLine>, val issues: List<String>,
    val unpricedIncidentCount: Int, val totals: DriverFinancialTotals?) {
    fun line(index: Int?) = lines.singleOrNull { it.lineIndex == index }
    fun reference(index: Int?) = line(index)?.let { IncidentFinancialReference(revision, it.moveId, it.saleLineId) }
}
internal fun parseFinancialReference(json: JSONObject?) = json?.let {
    IncidentFinancialReference(it.getInt("revision"), it.getLong("moveId"), it.getLong("saleLineId"))
}
private fun JSONObject.nullableText(key: String) = if (isNull(key)) null else getString(key)
internal fun parseDriverFinancial(json: JSONObject?, receivedNanos: Long = System.nanoTime()): DriverFinancialView? {
    if (json == null) return null // Compatible with a server preceding the financial contract.
    require(json.getInt("contractVersion") == 1) { "Unsupported financial contract" }
    val lines = json.getJSONArray("lines")
    val issues = json.getJSONArray("issues")
    return DriverFinancialView(json.getInt("revision"), json.getString("status"), json.getBoolean("fresh"),
        json.nullableText("error"), json.nullableText("checkedAt")?.let(Instant::parse), Instant.parse(json.getString("serverTime")),
        json.getLong("maxAgeSeconds"), receivedNanos,
        json.optJSONObject("currency")?.let { DriverCurrency(it.getString("name"), it.getInt("decimalPlaces"), it.getString("rounding")) },
        (0 until lines.length()).map { index -> val line = lines.getJSONObject(index)
            DriverFinancialLine(line.getInt("lineIndex"), line.getLong("moveId"), line.getLong("saleLineId"),
                line.getString("quantity"), line.getString("unit"), line.getString("unitPrice"), line.getString("discount"),
                line.getString("total"), line.getString("physicalRemaining"), line.nullableText("net"),
                line.nullableText("deduction"), line.nullableText("deferred")) },
        (0 until issues.length()).map(issues::getString), json.getInt("unpricedIncidentCount"),
        json.optJSONObject("totals")?.let { DriverFinancialTotals(it.getString("original"), it.getString("deduction"),
            it.getString("deferred"), it.getString("net"), it.getString("roundingAdjustment"), it.getString("remainingRoundingAdjustment")) })
}
internal fun financialFresh(view: DriverFinancialView?, nowNanos: Long = System.nanoTime()): Boolean {
    if (view == null || !view.fresh || view.error != null || view.checkedAt == null || nowNanos < view.receivedNanos) return false
    val initialAge = Duration.between(view.checkedAt, view.serverTime).toMillis()
    return initialAge >= 0 && initialAge + (nowNanos - view.receivedNanos) / 1_000_000 <= view.maxAgeSeconds * 1000
}
internal fun financialMoney(value: String, currency: DriverCurrency?): String {
    val amount = BigDecimal(value)
    val digits = currency?.decimalPlaces ?: 2
    val formatted = NumberFormat.getNumberInstance(Locale.forLanguageTag("es-MX")).apply {
        minimumFractionDigits = digits; maximumFractionDigits = maxOf(digits, amount.scale())
    }.format(amount)
    return "$formatted ${currency?.name.orEmpty()}".trim()
}
internal fun financialStatus(view: DriverFinancialView?, nowNanos: Long = System.nanoTime()): String = when {
    view == null || view.status == "unavailable" -> "Importes pendientes de sincronizar"
    view.status == "cancelled" -> "Entrega cancelada en Odoo · revisar con administración"
    view.status == "pending_validation" -> "Pendiente de validación · cantidades y precios aún no definitivos"
    !financialFresh(view, nowNanos) -> "Últimos importes consultados · esperando actualización"
    view.status != "ready" || view.issues.isNotEmpty() -> "Importes pendientes de revisión por administración"
    else -> "Cantidades e importes validados"
}
internal fun appendIncidentFinancial(payload: JSONObject, reference: IncidentFinancialReference?, replacementPayment: String?) {
    payload.put("financialContractVersion", 1)
    reference?.let { payload.put("financial", it.json()) }
    replacementPayment?.let { payload.put("replacementPayment", it) }
}
