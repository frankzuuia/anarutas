package com.five.anarutas.driver

import java.time.Instant

/** Presentation order only; route stops and payment commands retain their own order. */
internal fun compareCollectionReceipts(leftAt: String, leftId: String, rightAt: String, rightId: String): Int {
    val chronology = Instant.parse(leftAt).compareTo(Instant.parse(rightAt))
    return if (chronology != 0) chronology else leftId.compareTo(rightId)
}
