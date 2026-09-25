package com.five.anarutas.driver

// A local presentation acknowledgement, never consent to Google's terms on a user's behalf.
internal const val NAVIGATION_NOTICE_VERSION = 1
internal fun needsNavigationNotice(acknowledgedVersion: Int) = acknowledgedVersion < NAVIGATION_NOTICE_VERSION

/** Virtualized display chunks preserve every character of the bundled original. */
internal fun navigationLicenseChunks(text: String): List<String> = text.lineSequence().chunked(24)
    .map { it.joinToString("\n") }.toList()
