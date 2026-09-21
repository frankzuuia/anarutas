package com.five.anarutas.driver

object ClientValidation {
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
        val value = digits.toString()
        return when {
            value.length == 10 -> value
            value.length == 12 && value.startsWith("52") -> value.drop(2)
            value.length == 13 && value.startsWith("521") -> value.drop(3)
            else -> null
        }
    }

    fun pin(input: String): Boolean = input.length == 4 && input.all { it in '0'..'9' }
}
