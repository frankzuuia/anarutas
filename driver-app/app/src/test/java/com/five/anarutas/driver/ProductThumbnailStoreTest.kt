package com.five.anarutas.driver

import java.io.File
import java.util.UUID
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ProductThumbnailStoreTest {
    @get:Rule val files = TemporaryFolder()
    private val path = "/api/mobile/plans/${UUID.randomUUID()}/orders/${UUID.randomUUID()}/lines/0/thumbnail?revision=1"
    @Test fun boundsStreamsOnAllSupportedAndroidVersions() {
        val bytes = ByteArray(65_536) { (it % 127).toByte() }
        assertArrayEquals(bytes, readProductThumbnailStream(bytes.inputStream()))
        assertEquals(0, readProductThumbnailStream(byteArrayOf().inputStream()).size)
        assertThrows(java.io.IOException::class.java) { readProductThumbnailStream(ByteArray(65_537).inputStream()) }
    }
    @Test fun acceptsOnlyCanonicalPrivateThumbnailPaths() {
        assertTrue(isProductThumbnailPath(path))
        for (invalid in listOf("", "https://host$path", "//$path", "$path&token=secret", "$path#fragment",
            path.replace("revision=1", "revision=0"), path.replace("revision=1", "revision=99999999999999999999"),
            path.replace("/lines/0/", "/lines/-1/"), path.replace("/lines/0/", "/lines/1.5/"),
            path.replace("/orders/", "/../"), path.replace("/lines/0/", "/lines/9999999999999999999999/")))
            assertFalse(invalid, isProductThumbnailPath(invalid))
    }
    @Test fun cachesPrivateBytesAndAbsenceWithFreshStaleAndExpiredStates() {
        var now = System.currentTimeMillis()
        val store = ProductThumbnailStore(files.root) { now }
        val bytes = byteArrayOf(1, 2, 3)
        assertNull(store.read("https://server-a", "device-a", path))
        store.save("https://server-a", "device-a", path, bytes)
        assertArrayEquals(bytes, store.read("https://server-a", "device-a", path)!!.bytes)
        assertNull(store.read("https://server-b", "device-a", path))
        assertNull(store.read("https://server-a", "device-b", path))
        assertNull(store.read("https://server-a", "device-a", path.replace("revision=1", "revision=2")))
        now += 15 * 60_000L - 1
        assertTrue(store.read("https://server-a", "device-a", path)!!.fresh)
        now++
        assertFalse(store.read("https://server-a", "device-a", path)!!.fresh)
        now += 24 * 60 * 60_000L - 15 * 60_000L
        assertNull(store.read("https://server-a", "device-a", path))
        store.save("https://server-a", "device-a", path, null)
        assertNull(store.read("https://server-a", "device-a", path)!!.bytes)
        assertTrue(store.read("https://server-a", "device-a", path)!!.fresh)
        store.remove("https://server-a", "device-a", path)
        assertNull(store.read("https://server-a", "device-a", path))
    }
    @Test fun boundsCacheWithoutDeletingOtherAppFiles() {
        var now = System.currentTimeMillis()
        val unrelated = File(files.root, "evidence.jpg").apply { writeText("keep") }
        val store = ProductThumbnailStore(files.root) { now }
        val directory = File(files.root, "product-thumbnails")
        store.save("https://server", "device", path, null)
        // Real persisted cache files exercise pruning in one write, without
        // repeatedly rescanning the same directory hundreds of times in QA.
        for (index in 0..255) File(directory, "%064x.webp".format(index)).apply {
            writeBytes(byteArrayOf()); setLastModified(++now)
        }
        now++
        store.save("https://server", "device", path.replace("/lines/0/", "/lines/258/"), null)
        assertEquals(256, directory.listFiles()!!.size)
        assertNull(store.read("https://server", "device", path))
        for (index in 0..130) File(directory, "%064x.webp".format(index)).apply {
            writeBytes(ByteArray(65_536)); setLastModified(++now)
        }
        now++
        store.save("https://server", "device", path.replace("/lines/0/", "/lines/259/"), ByteArray(65_536))
        assertTrue(directory.listFiles()!!.sumOf { it.length() } <= 8 * 1024 * 1024)
        assertEquals("keep", unrelated.readText())
        assertThrows(IllegalArgumentException::class.java) { store.save("server", "device", path, ByteArray(65_537)) }
        assertThrows(IllegalArgumentException::class.java) { store.save("server", "device", path, byteArrayOf()) }
        assertThrows(IllegalArgumentException::class.java) { store.read("server", "", path) }
    }
}
