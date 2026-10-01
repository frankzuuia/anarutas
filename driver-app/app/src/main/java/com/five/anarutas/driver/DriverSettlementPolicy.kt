package com.five.anarutas.driver

// The server supplies the runtime policy; eligibility remains authoritative there.
internal fun routeLiquidationActionsVisible(completed: Boolean, warehouseRequired: Boolean, hasReceipts: Boolean) =
    hasReceipts && (completed || !warehouseRequired)
