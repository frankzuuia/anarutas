package com.five.anarutas.driver

import java.io.File
import java.util.UUID
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class IncidentCaptureStoreTest {
    @get:Rule val files = TemporaryFolder()
    @Test fun stagesThreeAsOneReversibleBatchAndKeepsDraftsAfterFailure() {
        val cache = files.newFolder("batch-cache")
        val backupExcluded = files.newFolder("batch-private")
        val store = IncidentCaptureStore(cache, backupExcluded)
        val camera = File(cache, "incident-camera").apply { mkdirs() }
        val sources = (1..3).map { index -> File(camera, "incident-$index.jpg").apply { writeBytes(byteArrayOf(index.toByte())) } }
        val keys = store.stageBatch(sources)
        assertEquals(3, keys.distinct().size)
        sources.forEachIndexed { index, source -> assertTrue(source.exists()); assertArrayEquals(source.readBytes(), store.read(keys[index])) }
        keys.forEach(store::discard)
        assertThrows(IllegalArgumentException::class.java) { store.stageBatch(emptyList()) }
        assertThrows(IllegalArgumentException::class.java) { store.stageBatch(sources + sources[0]) }
        val fourth = File(camera, "incident-4.jpg").apply { writeBytes(byteArrayOf(4)) }
        assertThrows(IllegalArgumentException::class.java) { store.stageBatch(sources + fourth) }
        assertThrows(IllegalArgumentException::class.java) { store.stageBatch(listOf(sources[0], sources[0])) }
        assertThrows(DriverApiException::class.java) { store.stageBatch(listOf(sources[0], File(camera, "incident-missing.jpg"))) }
        assertThrows(IllegalArgumentException::class.java) { store.stageBatch(listOf(sources[0], File(cache, "foreign.jpg"))) }
        assertTrue(sources.all { it.exists() })
        assertEquals(0, File(backupExcluded, "incident-outbox").listFiles()!!.size)
    }
    @Test fun storesPrivateBytesRemovesCameraCopyAndRejectsForeignPaths() {
        val cache = files.newFolder("cache")
        val backupExcluded = files.newFolder("private")
        val store = IncidentCaptureStore(cache, backupExcluded)
        val camera = File(cache, "incident-camera").apply { mkdirs() }
        val source = File(camera, "incident-${UUID.randomUUID()}.jpg").apply { writeBytes(byteArrayOf(1, 2, 3)) }
        val key = store.stage(source)
        assertFalse(source.exists())
        assertArrayEquals(byteArrayOf(1, 2, 3), store.read(key))
        assertTrue(File(backupExcluded, "incident-outbox/$key.jpg").isFile)
        assertThrows(IllegalArgumentException::class.java) { store.read("../other") }
        val foreign = File(cache, "incident-foreign.jpg").apply { writeBytes(byteArrayOf(1)) }
        assertThrows(IllegalArgumentException::class.java) { store.stage(foreign) }
        assertTrue(foreign.exists())
        store.discard(key)
        assertEquals(410, assertThrows(DriverApiException::class.java) { store.read(key) }.status)
        store.discard(key)
    }
    @Test fun expiresAt24HoursAndPrunesOnlyItsOwnOldFiles() {
        val cache = files.newFolder("cache")
        val backupExcluded = files.newFolder("private")
        var now = System.currentTimeMillis()
        val store = IncidentCaptureStore(cache, backupExcluded) { now }
        val camera = File(cache, "incident-camera").apply { mkdirs() }
        val source = File(camera, "incident-${UUID.randomUUID()}.jpg").apply { writeBytes(byteArrayOf(1)) }
        val key = store.stage(source)
        val stored = File(backupExcluded, "incident-outbox/$key.jpg")
        val created = stored.lastModified()
        now = created + 24L * 60 * 60 * 1000 - 1
        assertArrayEquals(byteArrayOf(1), store.read(key))
        now++
        assertEquals(410, assertThrows(DriverApiException::class.java) { store.read(key) }.status)
        val oldCamera = File(camera, "incident-old.jpg").apply { writeBytes(byteArrayOf(2)); setLastModified(created) }
        val youngCamera = File(camera, "incident-young.jpg").apply { writeBytes(byteArrayOf(3)); setLastModified(now) }
        val unrelated = File(cache, "keep.jpg").apply { writeBytes(byteArrayOf(4)); setLastModified(created) }
        store.prune()
        assertFalse(stored.exists()); assertFalse(oldCamera.exists())
        assertTrue(youngCamera.exists()); assertTrue(unrelated.exists())
    }
    @Test fun refusesEmptyOversizedAndMissingCapturesWithoutCreatingAnOutboxEntry() {
        val cache = files.newFolder("cache")
        val backupExcluded = files.newFolder("private")
        val store = IncidentCaptureStore(cache, backupExcluded)
        val camera = File(cache, "incident-camera").apply { mkdirs() }
        val source = File(camera, "incident-test.jpg")
        assertEquals(413, assertThrows(DriverApiException::class.java) { store.stage(source) }.status)
        source.writeBytes(byteArrayOf())
        assertEquals(413, assertThrows(DriverApiException::class.java) { store.stage(source) }.status)
        source.writeBytes(ByteArray(8 * 1024 * 1024 + 1))
        assertEquals(413, assertThrows(DriverApiException::class.java) { store.stage(source) }.status)
        assertEquals(0, File(backupExcluded, "incident-outbox").listFiles()!!.size)
    }
}
