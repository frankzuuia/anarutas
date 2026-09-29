package com.five.anarutas.driver

import java.io.OutputStream
import java.util.UUID

/** Bounded multipart stream; never creates an additional copy of all image bytes. */
internal class ProductPhotoUpload(command: String, photos: List<ByteArray>) {
    val boundary = "AnaRutas-${UUID.randomUUID()}"
    private val parts: List<ByteArray>
    val length: Long
    init {
        require(photos.size in 1..3)
        val metadata = command.toByteArray(Charsets.UTF_8)
        require(metadata.size <= 16_384 && photos.all { it.size in 1..8 * 1024 * 1024 })
        val chunks = mutableListOf<ByteArray>()
        fun text(value: String) { chunks.add(value.toByteArray(Charsets.UTF_8)) }
        text("--$boundary\r\nContent-Disposition: form-data; name=\"command\"\r\nContent-Type: application/json; charset=utf-8\r\n\r\n")
        chunks.add(metadata)
        photos.forEachIndexed { index, bytes ->
            text("\r\n--$boundary\r\nContent-Disposition: form-data; name=\"photos\"; filename=\"evidence-${index + 1}.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n")
            chunks.add(bytes)
        }
        text("\r\n--$boundary--\r\n")
        parts = chunks
        length = parts.sumOf { it.size.toLong() }
    }
    fun writeTo(output: OutputStream) { parts.forEach(output::write) }
}
