package com.five.anarutas.driver

import android.content.Context

internal data class NavigationProgress(val currentIndex: Int, val batchEndExclusive: Int)

/** Navigation-only cursor. Delivery and collection state never comes from this device. */
internal class NavigationProgressStore(context: Context) {
    private val preferences = context.getSharedPreferences("driver_navigation_v1", Context.MODE_PRIVATE)

    private fun key(plan: AssignedPlan) = "${plan.id}:${plan.publicationRevision}"

    fun isActive(plan: AssignedPlan): Boolean =
        preferences.getString("active_guidance", null) == key(plan)

    fun read(plan: AssignedPlan): NavigationProgress? {
        val value = preferences.getString(key(plan), null) ?: return null
        val pair = value.split(':')
        if (pair.size != 2) return null
        val index = pair[0].toIntOrNull() ?: return null
        val end = pair[1].toIntOrNull() ?: return null
        if (index !in plan.orders.indices || end <= index || end > plan.orders.size) return null
        return NavigationProgress(index, end)
    }

    fun save(plan: AssignedPlan, progress: NavigationProgress) {
        require(progress.currentIndex in plan.orders.indices)
        require(progress.batchEndExclusive > progress.currentIndex && progress.batchEndExclusive <= plan.orders.size)
        preferences.edit().putString(key(plan), "${progress.currentIndex}:${progress.batchEndExclusive}")
            .putString("active_guidance", key(plan)).apply()
    }

    fun clear(plan: AssignedPlan) {
        val editor = preferences.edit().remove(key(plan))
        if (isActive(plan)) editor.remove("active_guidance")
        editor.apply()
    }

    fun clearAll() {
        preferences.edit().clear().apply()
    }
}
