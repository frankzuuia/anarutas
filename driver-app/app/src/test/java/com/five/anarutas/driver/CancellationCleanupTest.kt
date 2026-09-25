package com.five.anarutas.driver

import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class CancellationCleanupTest {
    @Test fun releasesBlockingResourceWhenOwnerIsCancelled() = runBlocking {
        val opened = CompletableDeferred<Unit>()
        val closed = CountDownLatch(1)
        val closes = AtomicInteger()
        val job = launch(Dispatchers.IO) {
            withCancellationCleanup({ closes.incrementAndGet(); closed.countDown() }) {
                opened.complete(Unit)
                // A real blocking wait must be released by cleanup, not by finishing the body.
                check(closed.await(3, TimeUnit.SECONDS))
            }
        }
        withTimeout(4000) { opened.await(); job.cancelAndJoin() }
        assertEquals(1, closes.get())
    }
    @Test fun releasesExactlyOnceOnNormalReturnAndFailure() = runBlocking {
        val closes = AtomicInteger()
        assertEquals(42, withCancellationCleanup({ closes.incrementAndGet() }) { 42 })
        assertEquals(1, closes.get())
        try {
            withCancellationCleanup({ closes.incrementAndGet() }) { throw IllegalStateException("expected") }
            fail("Failure must propagate")
        } catch (error: IllegalStateException) { assertEquals("expected", error.message) }
        assertEquals(2, closes.get())
    }
}
