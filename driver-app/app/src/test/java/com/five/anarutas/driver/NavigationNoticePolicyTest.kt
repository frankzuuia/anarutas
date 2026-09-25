package com.five.anarutas.driver

import org.junit.Assert.*
import org.junit.Test

class NavigationNoticePolicyTest {
    @Test fun onlyAnExplicitCurrentAcknowledgementRemovesTheNotice() {
        assertTrue(needsNavigationNotice(0))
        assertTrue(needsNavigationNotice(-1))
        assertFalse(needsNavigationNotice(NAVIGATION_NOTICE_VERSION))
        assertFalse(needsNavigationNotice(NAVIGATION_NOTICE_VERSION + 1))
    }
    @Test fun virtualizedChunksKeepTheCompleteLicenseIncludingBlankLines() {
        for (count in listOf(0, 1, 23, 24, 25, 100)) {
            val text = (0 until count).joinToString("\n") { if (it % 3 == 0) "" else "Original license · línea $it" } + "\n"
            val chunks = navigationLicenseChunks(text)
            assertEquals(text, chunks.joinToString("\n"))
            assertTrue(chunks.all { it.lines().size <= 24 })
        }
    }
}
