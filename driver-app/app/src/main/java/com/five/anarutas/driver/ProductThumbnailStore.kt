package com.five.anarutas.driver

import java.io.File
import java.io.InputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.nio.file.Files
import java.util.UUID

internal fun isProductThumbnailPath(path: String): Boolean {
    val match = Regex("^/api/mobile/plans/([a-f0-9-]{36})/orders/([a-f0-9-]{36})/lines/(0|[1-9][0-9]*)/thumbnail\\?revision=([1-9][0-9]*)$").matchEntire(path) ?: return false
    return runCatching {
        UUID.fromString(match.groupValues[1]).toString() == match.groupValues[1] &&
            UUID.fromString(match.groupValues[2]).toString() == match.groupValues[2] &&
            match.groupValues[3].toInt() >= 0 && match.groupValues[4].toInt() > 0
    }.getOrDefault(false)
}

internal data class CachedProductThumbnail(val bytes: ByteArray?, val fresh: Boolean)

internal fun readProductThumbnailStream(stream: InputStream): ByteArray {
    val output = ByteArrayOutputStream()
    val chunk = ByteArray(4096)
    while (true) {
        val count = stream.read(chunk)
        if (count < 0) break
        if (output.size() + count > 65_536) throw IOException("INVALID_PRODUCT_IMAGE")
        output.write(chunk, 0, count)
    }
    return output.toByteArray()
}

/** Disposable private cache; never touches route state, camera images or evidence. */
internal class ProductThumbnailStore(cacheRoot: File, private val now: () -> Long = System::currentTimeMillis) {
    private val directory = File(cacheRoot, "product-thumbnails").also { check(it.mkdirs() || it.isDirectory) }
    private fun file(server: String, device: String, path: String): File {
        require(device.isNotBlank() && isProductThumbnailPath(path))
        val key = MessageDigest.getInstance("SHA-256").digest("$server\n$device\n$path".toByteArray())
            .joinToString("") { "%02x".format(it) }
        return File(directory, "$key.webp")
    }
    fun read(server: String, device: String, path: String): CachedProductThumbnail? = synchronized(lock) {
        val target = file(server, device, path)
        if (!target.isFile) return@synchronized null
        val age = now() - target.lastModified()
        if (age < 0 || age >= 24 * 60 * 60_000L || target.length() > 65_536) {
            target.delete(); return@synchronized null
        }
        val bytes = target.inputStream().use(::readProductThumbnailStream)
        CachedProductThumbnail(bytes.takeIf { it.isNotEmpty() }, age < 15 * 60_000L)
    }
    fun save(server: String, device: String, path: String, bytes: ByteArray?) = synchronized(lock) {
        require(bytes == null || bytes.size in 1..65_536)
        val target = file(server, device, path)
        target.writeBytes(bytes ?: byteArrayOf())
        check(target.setLastModified(now()))
        var total = 0L
        val files = directory.listFiles().orEmpty().filter {
            it.isFile && cacheName.matches(it.name) && it.parentFile == directory && !Files.isSymbolicLink(it.toPath())
        }.sortedByDescending { it.lastModified() }
        files.forEachIndexed { index, item ->
            total += item.length()
            if (index >= 256 || total > 8 * 1024 * 1024 || now() - item.lastModified() >= 24 * 60 * 60_000L) item.delete()
        }
    }
    fun remove(server: String, device: String, path: String) = synchronized(lock) { file(server, device, path).delete() }
    private companion object { val lock = Any(); val cacheName = Regex("[a-f0-9]{64}\\.webp") }
}
