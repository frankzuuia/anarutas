param([string[]]$Only = @())
$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskTempRoot = [IO.Path]::GetTempPath()
$workRoot = Join-Path $taskTempRoot ('ana-rutas-payment-mutations-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workRoot | Out-Null
foreach ($entry in @('gradle', 'gradlew', 'gradlew.bat', 'build.gradle.kts', 'settings.gradle.kts', 'gradle.properties')) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot $entry) -Destination $workRoot -Recurse
}
New-Item -ItemType Directory -Path (Join-Path $workRoot 'app') | Out-Null
foreach ($entry in @('build.gradle.kts', 'google-services.json', 'src')) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot ('app/' + $entry)) -Destination (Join-Path $workRoot 'app') -Recurse
}
$policy = Join-Path $workRoot 'app/src/main/java/com/five/anarutas/driver/DriverPaymentPolicy.kt'
$original = [IO.File]::ReadAllText($policy)
$cases = @(
    @{ name='capture_zero_change'; from='paymentPreview(method, receivedText, "0", expectedText, roundingText)'; to='paymentPreview(method, receivedText, receivedText, expectedText, roundingText)' },
    @{ name='capture_no_blank_default'; from='paymentPreview(method, receivedText, "0", expectedText, roundingText)'; to='paymentPreview(method, receivedText.ifBlank { "0" }, "0", expectedText, roundingText)' },
    @{ name='capture_preserves_method'; from='paymentPreview(method, receivedText, "0", expectedText, roundingText)'; to='paymentPreview("credit", receivedText, "0", expectedText, roundingText)' },
    @{ name='cash_overpayment'; from='received > expected'; to='false' },
    @{ name='reject_exact_zero'; from='received.signum() < 0'; to='received.signum() <= 0' },
    @{ name='partial_with_change'; from='change.signum() != 0 && balance.signum() != 0'; to='false' },
    @{ name='currency_quantum'; from='.any { it.remainder(rounding).signum() != 0 }'; to='.all { it.remainder(rounding).signum() != 0 }' },
    @{ name='credit_has_no_cash'; from='if (method == "credit") BigDecimal.ZERO'; to='if (false) BigDecimal.ZERO' },
    @{ name='transfer_has_no_change'; from='if (method == "cash") amount(changeText)'; to='if (true) amount(changeText)' },
    @{ name='retain_unauthenticated'; from='status == 401'; to='false' },
    @{ name='retain_timeout'; from='status == 408'; to='false' },
    @{ name='retain_throttled'; from='status == 429'; to='false' },
    @{ name='reject_terminal_conflict'; from='status !in 400..499'; to='status !in 400..408' },
    @{ name='stale_route'; from='requested == current'; to='requested.page == current.page' },
    @{ name='stale_page'; from='requested == current'; to='requested.executionId == current.executionId' },
    @{ name='foreign_device'; from='requestedDevice == currentDevice'; to='true' }
)
if ($Only.Count) { $cases = @($cases | Where-Object { $Only -contains $_.name }); if ($cases.Count -ne $Only.Count) { throw 'Unknown mutation filter' } }
$arguments = @('testDebugUnitTest', '--tests', 'com.five.anarutas.driver.DriverPaymentPolicyTest', '--console=plain')
$results = @()
Push-Location $workRoot
try {
    & .\gradlew.bat @arguments *> (Join-Path $workRoot 'baseline.log')
    if ($LASTEXITCODE -ne 0) { throw "Payment mutation baseline failed: $workRoot/baseline.log" }
    foreach ($case in $cases) {
        if ($original.Split($case.from).Count -ne 2) { throw ('Non-unique anchor: ' + $case.name) }
        [IO.File]::WriteAllText($policy, $original.Replace($case.from, $case.to), [Text.UTF8Encoding]::new($false))
        & .\gradlew.bat @arguments *> (Join-Path $workRoot ($case.name + '.log'))
        [xml]$xml = Get-Content -LiteralPath (Join-Path $workRoot 'app/build/test-results/testDebugUnitTest/TEST-com.five.anarutas.driver.DriverPaymentPolicyTest.xml') -Raw
        $killed = $LASTEXITCODE -ne 0 -and [int]$xml.testsuite.failures -gt 0
        $result = [PSCustomObject]@{ name=$case.name; killed=$killed; failures=[int]$xml.testsuite.failures }
        $results += $result
        $result | ConvertTo-Json -Compress
        [IO.File]::WriteAllText($policy, $original, [Text.UTF8Encoding]::new($false))
    }
    if ($results.Where({ !$_.killed }).Count -gt 0) { throw 'Payment mutation survived' }
} finally {
    Pop-Location
    $resolved = [IO.Path]::GetFullPath($workRoot)
    if (!$resolved.StartsWith([IO.Path]::GetFullPath($taskTempRoot), [StringComparison]::OrdinalIgnoreCase) -or
        ![IO.Path]::GetFileName($resolved).StartsWith('ana-rutas-payment-mutations-')) { throw 'Unsafe cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
# Gradle must fail for a killed mutant; do not expose that expected last exit as a failed audit.
exit 0
