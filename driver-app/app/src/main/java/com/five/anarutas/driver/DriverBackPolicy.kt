package com.five.anarutas.driver

internal enum class DriverBackTarget { DRAWER, FINANCE_ROUTES, HOME }

/** Dialog windows handle Back first; this resolves navigation in the underlying shell. */
internal fun driverBackTarget(drawerOpen: Boolean, destination: DriverDestination, financeExecutionId: String?): DriverBackTarget = when {
    drawerOpen -> DriverBackTarget.DRAWER
    destination == DriverDestination.FINANCE && financeExecutionId != null -> DriverBackTarget.FINANCE_ROUTES
    else -> DriverBackTarget.HOME
}
