package com.five.anarutas.driver

import android.content.Context
import java.io.File
import java.util.UUID

/** Private app-only outbox; photos never enter preferences, logs or the gallery. */
internal class IncidentCaptureStore(cacheRoot: File, backupExcludedRoot: File,
    private val now: () -> Long = System::currentTimeMillis) {
    constructor(context: Context) : this(context.cacheDir, context.noBackupFilesDir)
    private val camera = File(cacheRoot, "incident-camera")
    private val outbox = File(backupExcludedRoot, "incident-outbox").also { check(it.mkdirs() || it.isDirectory) }
    private fun file(key: String): File {
        require(UUID.fromString(key).toString() == key)
        return File(outbox, "$key.jpg").also { require(it.canonicalFile.parentFile == outbox.canonicalFile) }
    }
    fun stage(source: File): String {
        require(source.canonicalFile.parentFile == camera.canonicalFile && source.name.startsWith("incident-"))
        val bytes = readLimited(source)
        val key = UUID.randomUUID().toString()
        file(key).outputStream().use { it.write(bytes) }
        source.delete()
        return key
    }
    fun read(key: String): ByteArray {
        val file = file(key)
        if (!file.isFile || now() - file.lastModified() >= 24L * 60 * 60 * 1000)
            throw DriverApiException(410, "INCIDENT_CAPTURE_EXPIRED")
        return readLimited(file)
    }
    fun discard(key: String) { runCatching { file(key).delete() } }
    fun prune() {
        val cutoff = now() - 24L * 60 * 60 * 1000
        for (directory in listOf(camera, outbox)) directory.listFiles()?.filter {
            it.isFile && it.canonicalFile.parentFile == directory.canonicalFile && it.lastModified() <= cutoff
        }?.forEach { it.delete() }
    }
    private fun readLimited(file: File): ByteArray {
        if (!file.isFile || file.length() !in 1..8L * 1024 * 1024) throw DriverApiException(413, "UNIT_PHOTO_TOO_LARGE")
        return file.inputStream().use { input ->
            val output = java.io.ByteArrayOutputStream()
            val chunk = ByteArray(8192)
            while (true) {
                val count = input.read(chunk)
                if (count < 0) break
                if (output.size() + count > 8 * 1024 * 1024) throw DriverApiException(413, "UNIT_PHOTO_TOO_LARGE")
                output.write(chunk, 0, count)
            }
            val bytes = output.toByteArray()
            if (bytes.isEmpty() || bytes.size > 8 * 1024 * 1024) throw DriverApiException(413, "UNIT_PHOTO_TOO_LARGE")
            bytes
        }
    }
}
