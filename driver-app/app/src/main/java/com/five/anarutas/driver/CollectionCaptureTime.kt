package com.five.anarutas.driver

import java.time.Instant

/** Called when confirming collection, before DriverFinanceModel persists its command.
 * Retries send that same payload. Wall-clock changes and upload delay cannot extend the visit. */
internal fun collectionCaptureTime(serverTime: Instant, receivedElapsedMillis: Long, nowElapsedMillis: Long): Instant? =
    if (nowElapsedMillis < receivedElapsedMillis) null
    else serverTime.plusMillis(nowElapsedMillis - receivedElapsedMillis)
