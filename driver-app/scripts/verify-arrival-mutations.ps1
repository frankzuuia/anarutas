param([string]$ServerUrl = $env:ORG_GRADLE_PROJECT_ANA_RUTAS_SERVER_URL)
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
foreach ($file in @('DriverArrivalPolicy.kt', 'DriverExecution.kt', 'GuidanceResultPolicy.kt', 'NavigationNoticePolicy.kt')) {
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
    @{ name = 'address_allow_blank'; file = 'DriverExecution.kt'; test = 'CorrectedAddressFieldsTest'; from = 'it.isNotEmpty() && it.length <= maximum'; to = 'true && it.length <= maximum' },
    @{ name = 'address_allow_long'; file = 'DriverExecution.kt'; test = 'CorrectedAddressFieldsTest'; from = 'it.length <= maximum && it.none'; to = 'true && it.none' },
    @{ name = 'address_allow_control'; file = 'DriverExecution.kt'; test = 'CorrectedAddressFieldsTest'; from = 'it.none { character -> character.code < 32 }'; to = 'true' },
    @{ name = 'address_skip_trim'; file = 'DriverExecution.kt'; test = 'CorrectedAddressFieldsTest'; from = 'value.trim().takeIf'; to = 'value.takeIf' },
    @{ name = 'address_wrong_neighborhood'; file = 'DriverExecution.kt'; test = 'CorrectedAddressFieldsTest'; from = 'Col. $neighborhood, C.P.'; to = 'Col. $city, C.P.' },
    @{ name = 'guide_destroyed_screen'; file = 'GuidanceResultPolicy.kt'; test = 'GuidanceResultPolicyTest'; from = 'destroyed ||'; to = 'false ||' },
    @{ name = 'guide_retired_route'; file = 'GuidanceResultPolicy.kt'; test = 'GuidanceResultPolicyTest'; from = 'retired ||'; to = 'false ||' },
    @{ name = 'guide_old_request'; file = 'GuidanceResultPolicy.kt'; test = 'GuidanceResultPolicyTest'; from = 'requestGeneration != currentGeneration'; to = 'false' },
    @{ name = 'guide_old_point'; file = 'GuidanceResultPolicy.kt'; test = 'GuidanceResultPolicyTest'; from = 'requestedDestination != currentDestination'; to = 'false' },
    @{ name = 'notice_old_acknowledgement'; file = 'NavigationNoticePolicy.kt'; test = 'NavigationNoticePolicyTest'; from = 'acknowledgedVersion < NAVIGATION_NOTICE_VERSION'; to = 'false' },
    @{ name = 'notice_current_acknowledgement'; file = 'NavigationNoticePolicy.kt'; test = 'NavigationNoticePolicyTest'; from = 'acknowledgedVersion < NAVIGATION_NOTICE_VERSION'; to = 'acknowledgedVersion <= NAVIGATION_NOTICE_VERSION' },
    @{ name = 'notice_license_truncation'; file = 'NavigationNoticePolicy.kt'; test = 'NavigationNoticePolicyTest'; from = '.map { it.joinToString("\n") }.toList()'; to = '.take(1).map { it.joinToString("\n") }.toList()' }
)
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
