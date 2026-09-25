package com.five.anarutas.driver

import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/** Closes blocking resources when the owning coroutine is cancelled, not only after read returns. */
internal suspend fun <T> withCancellationCleanup(close: () -> Unit, block: suspend () -> T): T = coroutineScope {
    val watcher = launch(Dispatchers.IO, start = CoroutineStart.UNDISPATCHED) {
        try { awaitCancellation() } finally { close() }
    }
    try { block() } finally { watcher.cancel() }
}
