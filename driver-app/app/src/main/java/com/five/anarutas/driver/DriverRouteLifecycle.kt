package com.five.anarutas.driver

/** Only a newly confirmed closure of this publication clears its active workspace. */
internal fun driverWorkFinishedTransition(previous: AssignedPlan?, dashboard: DriverDashboard): Boolean =
    previous != null && previous.workCompletedAt == null && dashboard.plans.any {
        it.id == previous.id && it.publicationRevision == previous.publicationRevision && it.workCompletedAt != null
    }

internal fun keepFinanceSummaryOpen(destination: DriverDestination, workFinished: Boolean): Boolean =
    workFinished && destination == DriverDestination.FINANCE
