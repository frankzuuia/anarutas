param([string]$ServerUrl = $env:ORG_GRADLE_PROJECT_ANA_RUTAS_SERVER_URL, [switch]$RecoveryOnly, [switch]$IncidentFormOnly, [switch]$TrackingOnly, [switch]$ContinuationOnly, [switch]$EtaOnly, [switch]$ProductOnly, [switch]$ProductCaptureOnly, [switch]$ProductPresentationOnly, [switch]$ProductThumbnailOnly, [switch]$WarehouseOnly, [switch]$TrackingDestinationOnly)
$ErrorActionPreference = 'Stop'
# Mechanical mutations occur only in an isolated copy. No ADB, HTTP stubs or credential output.
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$workRoot = Join-Path ([IO.Path]::GetTempPath()) ('ana-rutas-arrival-mutations-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workRoot | Out-Null
foreach ($entry in @('gradle', 'gradlew', 'gradlew.bat', 'build.gradle.kts', 'settings.gradle.kts', 'gradle.properties')) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot $entry) -Destination $workRoot -Recurse
}
New-Item -ItemType Directory -Path (Join-Path $workRoot 'app') | Out-Null
foreach ($entry in @('build.gradle.kts', 'google-services.json', 'src')) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot ('app/' + $entry)) -Destination (Join-Path $workRoot 'app') -Recurse
}
$sourceFolder = Join-Path $workRoot 'app/src/main/java/com/five/anarutas/driver'
$originals = @{}
foreach ($file in @('DriverArrivalPolicy.kt', 'DriverExecution.kt', 'GuidanceResultPolicy.kt', 'NavigationNoticePolicy.kt', 'GpsRecoveryPolicy.kt', 'DriverServicePolicy.kt', 'RouteMarkerStyle.kt', 'IncidentReceiptPolicy.kt', 'IncidentFormPolicy.kt', 'LiveTrackingPolicy.kt', 'StopContinuationPolicy.kt', 'NavigationEtaPolicy.kt', 'ProductIncidentPolicy.kt', 'IncidentCaptureStore.kt', 'ProductPhotoUpload.kt', 'ProductThumbnailStore.kt', 'WarehouseReturnPolicy.kt', 'TrackingDestinationPolicy.kt')) {
    $originals[$file] = [IO.File]::ReadAllText((Join-Path $sourceFolder $file))
}
$cases = @(
    @{ name = 'allow_mock_gps'; from = 'if (gps.mock)'; to = 'if (false)' },
    @{ name = 'allow_stale_sample'; from = 'age > policy.maxSampleAgeSeconds * 1000L'; to = 'false' },
    @{ name = 'reject_exact_age_boundary'; from = 'age > policy.maxSampleAgeSeconds * 1000L'; to = 'age >= policy.maxSampleAgeSeconds * 1000L' },
    @{ name = 'allow_future_sample'; from = 'age < 0'; to = 'false' },
    @{ name = 'allow_inaccurate_sample'; from = 'gps.accuracy > policy.maxAccuracyMeters'; to = 'false' },
    @{ name = 'allow_negative_accuracy'; from = 'gps.accuracy < 0'; to = 'false' },
    @{ name = 'expand_radius_with_error'; from = 'pointDistance(gps.point, point) + gps.accuracy'; to = 'pointDistance(gps.point, point) - gps.accuracy' },
    @{ name = 'reject_exact_radius_boundary'; from = '<= policy.radiusMeters'; to = '< policy.radiusMeters' },
    @{ name = 'ignore_destination'; from = 'pointDistance(gps.point, point) +'; to = 'pointDistance(gps.point, gps.point) +' },
    @{ name = 'invert_sample_time'; from = 'sampleElapsed - receivedElapsed'; to = 'receivedElapsed - sampleElapsed' },
    @{ name = 'wrong_latitude_projection'; from = 'cos(a.latitude * rad)'; to = 'cos(a.latitude / rad)' },
    @{ name = 'fallback_on_non_imprecise_current'; from = 'currentEligibility != ArrivalEligibility.IMPRECISE'; to = 'false' },
    @{ name = 'reuse_sample_for_other_stop'; from = 'target != lastReadyPoint'; to = 'false' },
    @{ name = 'reuse_future_geofence_sample'; from = 'lastReady.elapsedMillis > current.elapsedMillis'; to = 'false' },
    @{ name = 'reuse_untrusted_sample'; from = 'return lastReady.takeIf { arrivalEligibility(it, target, policy, elapsed) == ArrivalEligibility.READY }'; to = 'return lastReady' },
    @{ name = 'accept_out_of_order_network_fix'; from = 'incoming.elapsedMillis >= current.elapsedMillis'; to = 'true' },
    @{ name = 'evaluate_with_previous_tick'; from = 'val elapsed = elapsedRealtime()'; to = 'val elapsed = elapsedRealtime() / 1000 * 1000' },
    @{ name = 'evaluate_without_live_clock'; from = 'val elapsed = elapsedRealtime()'; to = 'val elapsed = 0L' },
    @{ name = 'ignore_actionable_evaluation'; from = 'ArrivalEvaluation(usable, if (usable != null)'; to = 'ArrivalEvaluation(null, if (usable != null)' },
    @{ name = 'ready_label_on_invalid_sample'; from = 'arrivalEligibility(current, target, policy, elapsed))'; to = 'ArrivalEligibility.READY)' },
    @{ name = 'repoint_accept_invalid_current_location'; from = 'arrivalEligibility(gps, it, policy, elapsed) == ArrivalEligibility.READY'; to = 'true' },
    @{ name = 'address_allow_blank'; file = 'DriverExecution.kt'; test = 'CorrectedAddressFieldsTest'; from = 'it.isNotEmpty() && it.length <= maximum'; to = 'true && it.length <= maximum' },
    @{ name = 'address_allow_long'; file = 'DriverExecution.kt'; test = 'CorrectedAddressFieldsTest'; from = 'it.length <= maximum && it.none'; to = 'true && it.none' },
    @{ name = 'address_allow_control'; file = 'DriverExecution.kt'; test = 'CorrectedAddressFieldsTest'; from = 'it.none { character -> character.code < 32 }'; to = 'true' },
    @{ name = 'address_skip_trim'; file = 'DriverExecution.kt'; test = 'CorrectedAddressFieldsTest'; from = 'value.trim().takeIf'; to = 'value.takeIf' },
    @{ name = 'address_wrong_neighborhood'; file = 'DriverExecution.kt'; test = 'CorrectedAddressFieldsTest'; from = 'Col. $neighborhood, C.P.'; to = 'Col. $city, C.P.' },
    @{ name = 'guide_destroyed_screen'; file = 'GuidanceResultPolicy.kt'; test = 'GuidanceResultPolicyTest'; from = 'destroyed ||'; to = 'false ||' },
    @{ name = 'guide_retired_route'; file = 'GuidanceResultPolicy.kt'; test = 'GuidanceResultPolicyTest'; from = 'retired ||'; to = 'false ||' },
    @{ name = 'guide_old_request'; file = 'GuidanceResultPolicy.kt'; test = 'GuidanceResultPolicyTest'; from = 'requestGeneration != currentGeneration'; to = 'false' },
    @{ name = 'guide_old_point'; file = 'GuidanceResultPolicy.kt'; test = 'GuidanceResultPolicyTest'; from = 'requestedDestination != currentDestination'; to = 'false' },
    @{ name = 'guide_allow_retired_selection'; file = 'GuidanceResultPolicy.kt'; test = 'GuidanceResultPolicyTest'; from = '!state.retired'; to = 'true' },
    @{ name = 'guide_repeat_same_destination'; file = 'GuidanceResultPolicy.kt'; test = 'GuidanceResultPolicyTest'; from = '!state.alreadyGuidingToDestination'; to = 'true' },
    @{ name = 'notice_old_acknowledgement'; file = 'NavigationNoticePolicy.kt'; test = 'NavigationNoticePolicyTest'; from = 'acknowledgedVersion < NAVIGATION_NOTICE_VERSION'; to = 'false' },
    @{ name = 'notice_current_acknowledgement'; file = 'NavigationNoticePolicy.kt'; test = 'NavigationNoticePolicyTest'; from = 'acknowledgedVersion < NAVIGATION_NOTICE_VERSION'; to = 'acknowledgedVersion <= NAVIGATION_NOTICE_VERSION' },
    @{ name = 'notice_license_truncation'; file = 'NavigationNoticePolicy.kt'; test = 'NavigationNoticePolicyTest'; from = '.map { it.joinToString("\n") }.toList()'; to = '.take(1).map { it.joinToString("\n") }.toList()' }
)
if ($RecoveryOnly) { $cases = @() }
$cases += @(
    @{ name = 'gps_poll_background'; file = 'GpsRecoveryPolicy.kt'; test = 'GpsRecoveryPolicyTest'; from = '!active ||'; to = 'false ||' },
    @{ name = 'gps_poll_disabled_provider'; file = 'GpsRecoveryPolicy.kt'; test = 'GpsRecoveryPolicyTest'; from = '!providerEnabled ||'; to = 'false ||' },
    @{ name = 'gps_ignore_freshness'; file = 'GpsRecoveryPolicy.kt'; test = 'GpsRecoveryPolicyTest'; from = 'if (fresh)'; to = 'if (false)' },
    @{ name = 'gps_cancel_timeout_early'; file = 'GpsRecoveryPolicy.kt'; test = 'GpsRecoveryPolicyTest'; from = '>= GPS_REQUEST_TIMEOUT_MILLIS'; to = '> GPS_REQUEST_TIMEOUT_MILLIS' },
    @{ name = 'gps_parallel_requests'; file = 'GpsRecoveryPolicy.kt'; test = 'GpsRecoveryPolicyTest'; from = 'if (requestStarted != null) return if'; to = 'if (requestStarted != null && false) return if' },
    @{ name = 'gps_skip_backoff'; file = 'GpsRecoveryPolicy.kt'; test = 'GpsRecoveryPolicyTest'; from = 'now - lastAttempt < backoff'; to = 'false' },
    @{ name = 'gps_delay_backoff_boundary'; file = 'GpsRecoveryPolicy.kt'; test = 'GpsRecoveryPolicyTest'; from = 'now - lastAttempt < backoff'; to = 'now - lastAttempt <= backoff' },
    @{ name = 'gps_wrong_backoff_scale'; file = 'GpsRecoveryPolicy.kt'; test = 'GpsRecoveryPolicyTest'; from = '* 500L'; to = '* 1000L' },
    @{ name = 'gps_remove_min_backoff'; file = 'GpsRecoveryPolicy.kt'; test = 'GpsRecoveryPolicyTest'; from = 'coerceIn(1_000L, 10_000L)'; to = 'coerceIn(0L, 10_000L)' },
    @{ name = 'gps_remove_max_backoff'; file = 'GpsRecoveryPolicy.kt'; test = 'GpsRecoveryPolicyTest'; from = 'coerceIn(1_000L, 10_000L)'; to = 'coerceIn(1_000L, 30_000L)' },
    @{ name = 'gps_accept_stopped_callback'; file = 'GpsRecoveryPolicy.kt'; test = 'GpsRecoveryPolicyTest'; from = 'active && requestGeneration'; to = 'true && requestGeneration' },
    @{ name = 'gps_accept_old_generation'; file = 'GpsRecoveryPolicy.kt'; test = 'GpsRecoveryPolicyTest'; from = 'requestGeneration == generation'; to = 'true' },
    @{ name = 'map_hide_partial_delivery'; file = 'DriverServicePolicy.kt'; test = 'DriverServicePolicyTest'; from = 'orderStates.all { it.status in'; to = 'orderStates.any { it.status in' },
    @{ name = 'map_keep_terminal_pin'; file = 'DriverServicePolicy.kt'; test = 'DriverServicePolicyTest'; from = 'point != null && !isServiceFinished()'; to = 'point != null' },
    @{ name = 'map_show_missing_point'; file = 'DriverServicePolicy.kt'; test = 'DriverServicePolicyTest'; from = 'point != null && !isServiceFinished()'; to = '!isServiceFinished()' },
    @{ name = 'retry_allow_delivered'; file = 'DriverServicePolicy.kt'; test = 'DriverServicePolicyTest'; from = 'canRetryRescheduledOrder(status: OrderServiceStatus) = status == OrderServiceStatus.RESCHEDULED'; to = 'canRetryRescheduledOrder(status: OrderServiceStatus) = status == OrderServiceStatus.DELIVERED' },
    @{ name = 'closed_pin_wrong_color'; file = 'RouteMarkerStyle.kt'; test = 'DriverServicePolicyTest'; from = '#F59E42'; to = '#D0F58A' },
    @{ name = 'closed_selected_pin_loses_orange'; file = 'RouteMarkerStyle.kt'; test = 'DriverServicePolicyTest'; from = 'pending ->'; to = 'pending && !selected ->' },
    @{ name = 'receipt_announce_unconfirmed'; file = 'IncidentReceiptPolicy.kt'; test = 'IncidentReceiptPolicyTest'; from = 'if (!confirmed) return null'; to = 'if (false) return null' },
    @{ name = 'receipt_ignore_canonical_id'; file = 'IncidentReceiptPolicy.kt'; test = 'IncidentReceiptPolicyTest'; from = 'canonical.equals(incidentId, ignoreCase = true)'; to = 'true' },
    @{ name = 'receipt_drop_valid_id'; file = 'IncidentReceiptPolicy.kt'; test = 'IncidentReceiptPolicyTest'; from = 'return canonical'; to = 'return null' }
)
if ($IncidentFormOnly) {
    $cases = @(
        @{ name = 'form_ignore_availability'; from = 'available &&'; to = 'true &&' },
        @{ name = 'form_reject_without_orders'; from = '|| hasRejectableOrders'; to = '|| true' },
        @{ name = 'form_invert_closed_kind'; from = 'choice == IncidentChoice.CUSTOMER_CLOSED'; to = 'choice != IncidentChoice.CUSTOMER_CLOSED' },
        @{ name = 'form_wrong_wire_code'; from = 'ORDER_REJECTED("reject"'; to = 'ORDER_REJECTED("rejected"' },
        @{ name = 'form_wrong_closed_icon'; from = 'DriverIcon.STORE_CLOSED'; to = 'DriverIcon.ORDERS' },
        @{ name = 'form_note_truncates_early'; from = 'value.take(2000)'; to = 'value.take(1999)' },
        @{ name = 'form_note_allows_overflow'; from = 'value.take(2000)'; to = 'value.take(2001)' },
        @{ name = 'form_note_silently_trims'; from = 'value.take(2000)'; to = 'value.trim().take(2000)' }
    ) | ForEach-Object { $_.file = 'IncidentFormPolicy.kt'; $_.test = 'IncidentFormPolicyTest'; $_ }
}
if ($TrackingOnly) {
    $cases = @(
        @{ name = 'tracking_accept_mock'; from = '!it.mock'; to = 'true' },
        @{ name = 'tracking_accept_negative_accuracy'; from = 'it.accuracy >= 0'; to = 'true' },
        @{ name = 'tracking_reject_zero_accuracy'; from = 'it.accuracy >= 0'; to = 'it.accuracy > 0' },
        @{ name = 'tracking_accept_infinite_accuracy'; from = 'it.accuracy.isFinite()'; to = 'true' },
        @{ name = 'tracking_accept_invalid_latitude'; from = 'it.point.latitude in -90.0..90.0'; to = 'true' },
        @{ name = 'tracking_accept_invalid_longitude'; from = 'it.point.longitude in -180.0..180.0'; to = 'true' },
        @{ name = 'tracking_accept_stale'; from = 'now - it.elapsedMillis in 0..maximumAge'; to = 'true' },
        @{ name = 'tracking_reject_age_boundary'; from = '0..maximumAge'; to = '0 until maximumAge' },
        @{ name = 'tracking_accept_future'; from = '0..maximumAge'; to = 'Long.MIN_VALUE..maximumAge' },
        @{ name = 'tracking_continue_unauthorized'; from = 'status == 401'; to = 'false' },
        @{ name = 'tracking_continue_forbidden'; from = 'status == 403'; to = 'false' },
        @{ name = 'tracking_continue_missing_route'; from = 'status == 404'; to = 'false' },
        @{ name = 'tracking_continue_lost_session'; from = 'status == 409'; to = 'false' }
    ) | ForEach-Object { $_.file = 'LiveTrackingPolicy.kt'; $_.test = 'LiveTrackingPolicyTest'; $_ }
}
if ($ContinuationOnly) {
    $cases = @(
        @{ name = 'next_closed_without_pending'; from = 'kind == "closed" && stop.hasPendingRetry()'; to = 'kind == "closed"' },
        @{ name = 'next_wrong_closed_command'; from = 'kind == "closed"'; to = 'kind == "phone"' },
        @{ name = 'next_wrong_delivery_command'; from = 'kind == "service"'; to = 'kind == "arrival"' },
        @{ name = 'next_on_rejection'; from = 'serviceKind == "deliver"'; to = 'true' },
        @{ name = 'next_on_partial_delivery'; from = '&& stop.isServiceFinished()'; to = '&& true' },
        @{ name = 'next_wrong_completion'; from = '-> StopCompletion.CUSTOMER_CLOSED'; to = '-> StopCompletion.DELIVERED' },
        @{ name = 'next_lose_receipt_identity'; from = 'StopContinuation(commandId, stop.id, completion)'; to = 'StopContinuation(stop.id, commandId, completion)' },
        @{ name = 'next_reverse_route'; from = 'stops.sortedBy { it.position }'; to = 'stops.sortedByDescending { it.position }' },
        @{ name = 'next_allow_missing_origin'; from = 'if (current < 0) return null'; to = 'if (false) return null' },
        @{ name = 'next_return_same_stop'; from = 'ordered.drop(current + 1)'; to = 'ordered.drop(current)' },
        @{ name = 'next_drop_earlier_pending'; from = '+ ordered.take(current)'; to = '+ emptyList<ExecutionStop>()' },
        @{ name = 'next_choose_last'; from = '.firstOrNull {'; to = '.lastOrNull {' },
        @{ name = 'next_ignore_missing_point'; from = 'it.isVisibleOnMap() &&'; to = 'true &&' },
        @{ name = 'next_accept_unknown_orders'; from = 'it.orderStates.any { order -> canDeliverOrder(order.status) }'; to = 'true' },
        @{ name = 'preview_during_guidance'; from = '!guiding &&'; to = 'true &&' },
        @{ name = 'preview_during_calculation'; from = '!calculating &&'; to = 'true &&' },
        @{ name = 'preview_during_restored_guidance'; from = '!sdkGuiding &&'; to = 'true &&' },
        @{ name = 'preview_after_repoint'; from = '&& !corrected'; to = '&& true' }
    ) | ForEach-Object { $_.file = 'StopContinuationPolicy.kt'; $_.test = 'StopContinuationPolicyTest'; $_ }
}
if ($EtaOnly) {
    $cases = @(
        @{ name = 'eta_wrong_execution'; from = 'execution != executionId'; to = 'false' },
        @{ name = 'eta_wrong_stop'; from = 'stop != stopId'; to = 'false' },
        @{ name = 'eta_old_result'; from = 'key == destinationKey'; to = 'true' },
        @{ name = 'eta_stale_during_calculation'; from = 'if (calculating)'; to = 'if (false)' },
        @{ name = 'eta_guidance_stopped'; from = '!guiding ||'; to = 'false ||' },
        @{ name = 'eta_negative'; from = 'seconds < 0'; to = 'seconds < -1' },
        @{ name = 'eta_zero_boundary'; from = 'seconds < 0'; to = 'seconds <= 0' },
        @{ name = 'eta_no_reset'; from = 'key = null; executionId = null; stopId = null; calculating = false'; to = 'calculating = false' },
        @{ name = 'eta_lost_begin'; from = 'calculating = true'; to = 'calculating = false' },
        @{ name = 'eta_wrong_value'; from = 'NavigationEta(stop, "ready", seconds)'; to = 'NavigationEta(stop, "ready", 0)' },
        @{ name = 'eta_ignore_arrival'; from = 'if (arrived)'; to = 'if (false)' },
        @{ name = 'eta_ignore_stale_gps'; from = 'if (!freshGps)'; to = 'if (false)' },
        @{ name = 'eta_accept_unavailable'; from = 'eta.state != "ready" ||'; to = 'false ||' },
        @{ name = 'eta_round_down'; from = '+ 59'; to = '+ 0' },
        @{ name = 'eta_minute_boundary'; from = 'seconds < 60'; to = 'seconds <= 60' }
    ) | ForEach-Object { $_.file = 'NavigationEtaPolicy.kt'; $_.test = 'NavigationEtaPolicyTest'; $_ }
}
if ($ProductOnly) {
    $cases = @(
        @{ name = 'product_ignore_required_evidence'; from = '= !kind.manual'; to = '= false' },
        @{ name = 'product_force_shortage_evidence'; from = '= !kind.manual'; to = '= true' },
        @{ name = 'product_allow_zero'; from = 'it > BigDecimal.ZERO'; to = 'it >= BigDecimal.ZERO' },
        @{ name = 'product_ignore_order'; from = 'it.shipmentId == shipmentId'; to = 'true' },
        @{ name = 'product_ignore_line'; from = 'it.lineIndex == lineIndex'; to = 'true' },
        @{ name = 'product_count_canceled'; from = 'it.status != "canceled"'; to = 'true' },
        @{ name = 'product_count_editing_incident'; from = 'it.id != exceptId'; to = 'true' },
        @{ name = 'product_draft_mislabels_new'; from = 'if (saved == null) return true'; to = 'if (saved == null) return false' },
        @{ name = 'product_draft_misses_note_edit'; from = 'note != saved.additionalNote'; to = 'false' },
        @{ name = 'product_draft_misses_quantity_edit'; from = 'productQuantity(quantity)?.compareTo(productQuantity(saved.quantity)) != 0'; to = 'false' },
        @{ name = 'product_draft_mislabels_decimal_format'; from = 'productQuantity(quantity)?.compareTo(productQuantity(saved.quantity)) != 0'; to = 'quantity != saved.quantity' },
        @{ name = 'product_add_instead_subtract'; from = '.subtract(incidents.filter'; to = '.add(incidents.filter' },
        @{ name = 'product_allow_negative_remaining'; from = '.max(BigDecimal.ZERO)'; to = '' },
        @{ name = 'product_drop_accumulation'; from = 'total.add(BigDecimal(incident.quantity))'; to = 'BigDecimal(incident.quantity)' },
        @{ name = 'product_allow_long_note'; from = 'note.length > 2000'; to = 'note.length > 2001' },
        @{ name = 'product_reject_note_boundary'; from = 'note.length > 2000'; to = 'note.length >= 2000' },
        @{ name = 'product_allow_excess_quantity'; from = 'amount <= remaining'; to = 'true' },
        @{ name = 'product_reject_exact_remaining'; from = 'amount <= remaining'; to = 'amount < remaining' },
        @{ name = 'product_allow_long_name'; from = 'product.trim().length <= 300'; to = 'true' },
        @{ name = 'product_allow_long_unit'; from = 'unit.trim().length <= 40'; to = 'true' },
        @{ name = 'product_allow_blank_name'; from = 'product.trim().isNotEmpty()'; to = 'true' },
        @{ name = 'product_allow_blank_unit'; from = 'unit.trim().isNotEmpty()'; to = 'true' },
        @{ name = 'product_allow_controls'; from = '(product + unit).none { it.code < 32 }'; to = 'true' },
        @{ name = 'product_four_photos'; from = '1 else 0)..3'; to = '1 else 0)..4' },
        @{ name = 'product_two_photo_limit'; from = '1 else 0)..3'; to = '1 else 0)..2' },
        @{ name = 'product_zero_required_photos'; from = '1 else 0)..3'; to = '0 else 0)..3' },
        @{ name = 'product_force_optional_photos'; from = '1 else 0)..3'; to = '1 else 1)..3' },
        @{ name = 'product_invert_comments'; from = 'it.code in selected'; to = 'it.code !in selected' },
        @{ name = 'product_untrimmed_note'; from = '+ note.trim()'; to = '+ note' },
        @{ name = 'product_empty_comment_lines'; from = '.filter { it.isNotBlank() }'; to = '' },
        @{ name = 'product_join_comments_without_separator'; from = 'joinToString("\n")'; to = 'joinToString("")' }
    ) | ForEach-Object { $_.file = 'ProductIncidentPolicy.kt'; $_.test = 'ProductIncidentPolicyTest'; $_ }
}
if ($ProductCaptureOnly) {
    $cases = @(
        @{ name = 'batch_allow_four'; from = 'sources.size in 1..3'; to = 'sources.size in 1..4' },
        @{ name = 'batch_allow_duplicates'; from = 'sources.map { it.canonicalPath }.distinct().size == sources.size'; to = 'true' },
        @{ name = 'batch_lose_drafts'; from = 'return keys'; to = 'sources.forEach { it.delete() }; return keys' },
        @{ name = 'batch_leak_partial_upload'; from = 'keys.forEach(::discard); throw failure'; to = 'throw failure' }
    ) | ForEach-Object { $_.file = 'IncidentCaptureStore.kt'; $_.test = 'IncidentCaptureStoreTest'; $_ }
    $cases += @(
        @{ name = 'upload_allow_four'; from = 'photos.size in 1..3'; to = 'photos.size in 1..4' },
        @{ name = 'upload_reject_maximum_metadata'; from = 'metadata.size <= 16_384'; to = 'metadata.size < 16_384' },
        @{ name = 'upload_allow_oversized_photo'; from = 'photos.all { it.size in 1..8 * 1024 * 1024 }'; to = 'true' },
        @{ name = 'upload_lose_metadata'; from = 'chunks.add(metadata)'; to = '' },
        @{ name = 'upload_wrong_length'; from = 'parts.sumOf { it.size.toLong() }'; to = 'parts.size.toLong()' }
    ) | ForEach-Object { $_.file = 'ProductPhotoUpload.kt'; $_.test = 'ProductPhotoUploadTest'; $_ }
}
if ($ProductPresentationOnly) {
    $cases = @(
        @{ name = 'quantity_keep_trailing_zeros'; from = 'value.toBigDecimalOrNull()?.stripTrailingZeros()?.toPlainString() ?: value'; to = 'value' },
        @{ name = 'quantity_round_fraction'; from = 'value.toBigDecimalOrNull()?.stripTrailingZeros()?.toPlainString() ?: value'; to = 'value.toBigDecimalOrNull()?.setScale(0, java.math.RoundingMode.DOWN)?.toPlainString() ?: value' },
        @{ name = 'shortage_offer_wrong_comments'; from = 'if (kind.manual) listOf(ProductComment.MISSING)'; to = 'if (!kind.manual) listOf(ProductComment.MISSING)' }
    ) | ForEach-Object { $_.file = 'ProductIncidentPolicy.kt'; $_.test = 'ProductIncidentPolicyTest'; $_ }
}
if ($ProductThumbnailOnly) {
    $cases = @(
        @{ name = 'thumbnail_allow_external_url'; from = '.matchEntire(path) ?: return false'; to = '.matchEntire(path) ?: return true' },
        @{ name = 'thumbnail_share_between_devices'; from = '"$server\n$device\n$path"'; to = '"$server\n$path"' },
        @{ name = 'thumbnail_unbounded_stream'; from = 'output.size() + count > 65_536'; to = 'false' },
        @{ name = 'thumbnail_never_refresh'; from = 'age < 15 * 60_000L'; to = 'true' }
    ) | ForEach-Object { $_.file = 'ProductThumbnailStore.kt'; $_.test = 'ProductThumbnailStoreTest'; $_ }
}
if ($WarehouseOnly) {
    $cases = @(
        @{ name = 'warehouse_wrong_plan'; from = 'route.id != execution.planId'; to = 'false' },
        @{ name = 'warehouse_old_publication'; from = 'route.publicationRevision != execution.publicationRevision'; to = 'false' },
        @{ name = 'warehouse_unstarted'; from = 'route.startedAt.isNullOrBlank()'; to = 'false' },
        @{ name = 'warehouse_blank_address'; from = 'departure.address.isBlank()'; to = 'false' },
        @{ name = 'warehouse_invalid_latitude'; from = 'departure.latitude !in -90.0..90.0'; to = 'false' },
        @{ name = 'warehouse_invalid_longitude'; from = 'departure.longitude !in -180.0..180.0'; to = 'false' },
        @{ name = 'warehouse_ignore_version'; from = 'departure.version < 1'; to = 'false' },
        @{ name = 'warehouse_allow_pending'; from = 'states.any { it.status !in listOf(OrderServiceStatus.DELIVERED, OrderServiceStatus.RESCHEDULED) }'; to = 'false' },
        @{ name = 'warehouse_after_completion'; from = 'route.completedAt != null || execution.completedAt != null'; to = 'false' },
        @{ name = 'warehouse_missing_states'; from = 'states.size != stop.shipmentIds.size'; to = 'false' },
        @{ name = 'warehouse_foreign_states'; from = 'states.map { it.shipmentId }.toSet() != stop.shipmentIds.toSet()'; to = 'false' },
        @{ name = 'warehouse_stale_origin_key'; from = ':${departure.version}:'; to = ':' },
        @{ name = 'warehouse_stale_execution_key'; from = '$executionId:$etaId'; to = 'fixed:$etaId' }
    ) | ForEach-Object { $_.file = 'WarehouseReturnPolicy.kt'; $_.test = 'WarehouseReturnPolicyTest'; $_ }
}
if ($TrackingDestinationOnly) {
    $cases = @(
        @{ name = 'return_without_calculation'; from = 'navigating && requestedKey == warehouse.key'; to = 'requestedKey == warehouse.key' },
        @{ name = 'return_without_guidance'; from = 'guiding && activeKey == warehouse.key'; to = 'activeKey == warehouse.key' },
        @{ name = 'return_wrong_requested_key'; from = 'requestedKey == warehouse.key'; to = 'true' },
        @{ name = 'return_wrong_active_key'; from = 'activeKey == warehouse.key'; to = 'true' },
        @{ name = 'return_wrong_version'; from = 'depotVersion = warehouse.departure.version'; to = 'depotVersion = 1' },
        @{ name = 'intent_customer_becomes_warehouse'; from = 'stopId == null && depotVersion > 0'; to = 'depotVersion > 0' },
        @{ name = 'intent_accept_zero_version'; from = 'depotVersion > 0'; to = 'depotVersion >= 0' },
        @{ name = 'replay_rejected_origin'; from = 'target.depotVersion == rejectedDepotVersion'; to = 'false' },
        @{ name = 'reject_any_version'; from = 'target.depotVersion == rejectedDepotVersion'; to = 'true' },
        @{ name = 'relax_all_conflicts'; from = 'status == 409 && code in'; to = 'status == 409 || code in' },
        @{ name = 'report_missing_sdk_destination'; from = 'if (target.depotVersion != null && (eta == null ||'; to = 'if (target.depotVersion != null && eta != null && (' },
        @{ name = 'report_foreign_sdk_destination'; from = 'eta.targetStopId != target.etaId'; to = 'false' },
        @{ name = 'report_stopped_sdk_guidance'; from = 'eta.state != "calculating" && !guiding'; to = 'false' }
    ) | ForEach-Object { $_.file = 'TrackingDestinationPolicy.kt'; $_.test = 'TrackingDestinationPolicyTest'; $_ }
}
$arguments = @('testDebugUnitTest', '--console=plain')
if ($ServerUrl) { $arguments += ('-PANA_RUTAS_SERVER_URL=' + $ServerUrl) }
Push-Location $workRoot
try {
    & .\gradlew.bat @arguments *> (Join-Path $workRoot 'baseline.log')
    if ($LASTEXITCODE -ne 0) { throw "Baseline failed; inspect $workRoot/baseline.log" }
    $results = @()
    foreach ($case in $cases) {
        $file = if ($case.file) { $case.file } else { 'DriverArrivalPolicy.kt' }
        $testClass = if ($case.test) { $case.test } else { 'DriverArrivalPolicyTest' }
        $policy = Join-Path $sourceFolder $file
        $original = $originals[$file]
        if (!$original.Contains($case.from)) { throw ('Mutation anchor missing: ' + $case.name) }
        [IO.File]::WriteAllText($policy, $original.Replace($case.from, $case.to), [Text.UTF8Encoding]::new($false))
        $report = Join-Path $workRoot ('app/build/test-results/testDebugUnitTest/TEST-com.five.anarutas.driver.' + $testClass + '.xml')
        if (Test-Path -LiteralPath $report) { Remove-Item -LiteralPath $report }
        & .\gradlew.bat @arguments --tests ('com.five.anarutas.driver.' + $testClass) *> (Join-Path $workRoot ($case.name + '.log'))
        $exitCode = $LASTEXITCODE
        [IO.File]::WriteAllText($policy, $original, [Text.UTF8Encoding]::new($false))
        if (!(Test-Path -LiteralPath $report)) { throw ('Missing test report: ' + $case.name) }
        [xml]$xml = Get-Content -LiteralPath $report -Raw
        $killed = $exitCode -ne 0 -and [int]$xml.testsuite.failures -gt 0
        $results += [pscustomobject]@{ mutation = $case.name; killed = $killed; failures = [int]$xml.testsuite.failures }
        Write-Output ('{0}: {1}' -f $case.name, $(if ($killed) { 'KILLED' } else { 'SURVIVED / INFRA FAILURE' }))
    }
    $results | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $workRoot 'results.json')
    Write-Output ('Evidence: ' + $workRoot)
    if (@($results | Where-Object { !$_.killed }).Count -gt 0) { throw 'Mutation gate did not pass.' }
} finally {
    foreach ($file in $originals.Keys) {
        [IO.File]::WriteAllText((Join-Path $sourceFolder $file), $originals[$file], [Text.UTF8Encoding]::new($false))
    }
    Pop-Location
}
