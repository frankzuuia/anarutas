package com.five.anarutas.driver

import java.net.URI

object ClientValidation {
    fun serverOrigin(input: String): String? {
        val candidate = input.trim().trimEnd('/')
        val uri = runCatching { URI(candidate) }.getOrNull() ?: return null
        if (uri.scheme != "https" || uri.host.isNullOrBlank() || uri.userInfo != null ||
            !uri.path.isNullOrEmpty() || uri.query != null || uri.fragment != null
        ) return null
        return uri.toASCIIString()
    }

    fun phone(input: String): String? {
        val trimmed = input.trim()
        if (trimmed.length > 40) return null
        val digits = StringBuilder()
        trimmed.forEachIndexed { index, char ->
            when {
                char in '0'..'9' -> digits.append(char)
                char == '+' && index == 0 -> Unit
                char in "-() ." -> Unit
                else -> return null
            }
        }
        return digits.toString().takeIf { it.length in 10..15 }
    }

    fun pin(input: String): Boolean = input.length == 4 && input.all { it in '0'..'9' }
    fun activationCode(input: String): Boolean =
        input.length == 64 && input.all { it in '0'..'9' || it in 'a'..'f' }
}
