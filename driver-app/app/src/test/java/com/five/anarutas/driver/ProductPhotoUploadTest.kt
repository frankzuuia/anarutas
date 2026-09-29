package com.five.anarutas.driver

import java.io.ByteArrayOutputStream
import org.junit.Assert.*
import org.junit.Test

class ProductPhotoUploadTest {
    @Test fun writesAllPhotosAsSeparatePartsWithExactUtf8Length() {
        for (count in 1..3) {
            val photos = (1..count).map { byteArrayOf(it.toByte(), 0, 4) }
            val upload = ProductPhotoUpload("{\"note\":\"Limón\"}", photos)
            val output = ByteArrayOutputStream(); upload.writeTo(output)
            assertEquals(output.size().toLong(), upload.length)
            val text = output.toByteArray().toString(Charsets.UTF_8)
            assertTrue(text.contains("{\"note\":\"Limón\"}"))
            assertEquals(count, text.split("name=\"photos\"").size - 1)
            assertTrue(text.endsWith("--${upload.boundary}--\r\n"))
            photos.forEachIndexed { index, _ -> assertTrue(text.contains("filename=\"evidence-${index + 1}.jpg\"")) }
        }
    }
    @Test fun rejectsFourthPhotoEmptyOrOversizedPayloads() {
        assertThrows(IllegalArgumentException::class.java) { ProductPhotoUpload("{}", emptyList()) }
        assertThrows(IllegalArgumentException::class.java) { ProductPhotoUpload("{}", List(4) { byteArrayOf(1) }) }
        assertThrows(IllegalArgumentException::class.java) { ProductPhotoUpload("{}", listOf(byteArrayOf())) }
        assertThrows(IllegalArgumentException::class.java) { ProductPhotoUpload("{}", listOf(ByteArray(8 * 1024 * 1024 + 1))) }
        assertThrows(IllegalArgumentException::class.java) { ProductPhotoUpload("a".repeat(16_385), listOf(byteArrayOf(1))) }
        assertTrue(ProductPhotoUpload("a".repeat(16_384), listOf(ByteArray(8 * 1024 * 1024))).length > 8 * 1024 * 1024)
    }
}
