param([string[]]$Only = @(), [ValidateSet('financial', 'receipt', 'navigation')][string]$Scope = 'financial')
$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskTempRoot = [IO.Path]::GetTempPath()
$workRoot = Join-Path $taskTempRoot ('ana-rutas-financial-mutations-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workRoot | Out-Null
foreach ($entry in @('gradle', 'gradlew', 'gradlew.bat', 'build.gradle.kts', 'settings.gradle.kts', 'gradle.properties')) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot $entry) -Destination $workRoot -Recurse
}
New-Item -ItemType Directory -Path (Join-Path $workRoot 'app') | Out-Null
foreach ($entry in @('build.gradle.kts', 'google-services.json', 'src')) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot ('app/' + $entry)) -Destination (Join-Path $workRoot 'app') -Recurse
}
$policyFile = switch ($Scope) { 'receipt' { 'DriverReceiptOrder.kt' } 'navigation' { 'DriverBackPolicy.kt' } default { 'DriverFinancial.kt' } }
$policy = Join-Path $workRoot ('app/src/main/java/com/five/anarutas/driver/' + $policyFile)
$original = [IO.File]::ReadAllText($policy)
$cases = @(
    @{ name='ignore_source_error'; from='view.error != null ||'; to='false ||' },
    @{ name='ignore_freshness_flag'; from='!view.fresh ||'; to='false ||' },
    @{ name='ignore_monotonic_clock'; from='nowNanos < view.receivedNanos'; to='false' },
    @{ name='accept_future_source'; from='initialAge >= 0 &&'; to='true &&' },
    @{ name='ignore_expiry'; from='<= view.maxAgeSeconds * 1000'; to='<= Long.MAX_VALUE' },
    @{ name='reject_exact_expiry'; from='<= view.maxAgeSeconds * 1000'; to='< view.maxAgeSeconds * 1000' },
    @{ name='show_undelivered'; from='status == "delivered" && paymentConfirmed'; to='paymentConfirmed' },
    @{ name='show_unpaid'; from='status == "delivered" && paymentConfirmed'; to='status == "delivered"' },
    @{ name='hide_finalized'; from='status == "delivered" && paymentConfirmed'; to='false' },
    @{ name='lose_exact_cents'; from='}.format(amount.abs())'; to='}.format(amount.abs().toDouble())' },
    @{ name='remove_currency_symbol'; from='Currency.getInstance(currency.name).getSymbol(Locale.forLanguageTag("es-MX"))'; to='""' }
)
if ($Scope -eq 'receipt') {
    $cases = @(
        @{ name='prepend_new_collection'; from='Instant.parse(leftAt).compareTo(Instant.parse(rightAt))'; to='Instant.parse(rightAt).compareTo(Instant.parse(leftAt))' },
        @{ name='ignore_collection_time'; from='chronology != 0'; to='false' },
        @{ name='unstable_simultaneous_collection'; from='else leftId.compareTo(rightId)'; to='else 0' }
    )
}
if ($Scope -eq 'navigation') {
    $cases = @(
        @{ name='navigate_with_drawer_open'; from='drawerOpen -> DriverBackTarget.DRAWER'; to='false -> DriverBackTarget.DRAWER' },
        @{ name='leave_finance_detail_for_home'; from='-> DriverBackTarget.FINANCE_ROUTES'; to='-> DriverBackTarget.HOME' },
        @{ name='trap_finance_list'; from='financeExecutionId != null'; to='true' },
        @{ name='hijack_other_tabs'; from='destination == DriverDestination.FINANCE &&'; to='true &&' }
    )
}
if ($Only.Count) { $cases = @($cases | Where-Object { $Only -contains $_.name }); if ($cases.Count -ne $Only.Count) { throw 'Unknown mutation filter' } }
$testClass = switch ($Scope) { 'receipt' { 'DriverReceiptOrderTest' } 'navigation' { 'DriverBackPolicyTest' } default { 'DriverFinancialTest' } }
$arguments = @('testDebugUnitTest', '--tests', ('com.five.anarutas.driver.' + $testClass), '--console=plain')
$results = @()
Push-Location $workRoot
try {
    & .\gradlew.bat @arguments *> (Join-Path $workRoot 'baseline.log')
    if ($LASTEXITCODE -ne 0) { throw "Financial mutation baseline failed: $workRoot/baseline.log" }
    foreach ($case in $cases) {
        if ($original.Split($case.from).Count -ne 2) { throw ('Non-unique anchor: ' + $case.name) }
        [IO.File]::WriteAllText($policy, $original.Replace($case.from, $case.to), [Text.UTF8Encoding]::new($false))
        & .\gradlew.bat @arguments *> (Join-Path $workRoot ($case.name + '.log'))
        [xml]$xml = Get-Content -LiteralPath (Join-Path $workRoot ('app/build/test-results/testDebugUnitTest/TEST-com.five.anarutas.driver.' + $testClass + '.xml')) -Raw
        $killed = $LASTEXITCODE -ne 0 -and [int]$xml.testsuite.failures -gt 0
        $result = [PSCustomObject]@{ name=$case.name; killed=$killed; failures=[int]$xml.testsuite.failures }
        $results += $result
        $result | ConvertTo-Json -Compress
        [IO.File]::WriteAllText($policy, $original, [Text.UTF8Encoding]::new($false))
    }
    if ($results.Where({ !$_.killed }).Count -gt 0) { throw 'Financial mutation survived' }
} finally {
    Pop-Location
    $resolved = [IO.Path]::GetFullPath($workRoot)
    if (!$resolved.StartsWith([IO.Path]::GetFullPath($taskTempRoot), [StringComparison]::OrdinalIgnoreCase) -or
        ![IO.Path]::GetFileName($resolved).StartsWith('ana-rutas-financial-mutations-')) { throw 'Unsafe cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
exit 0
