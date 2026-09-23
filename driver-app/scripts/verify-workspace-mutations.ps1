param([string]$ServerUrl = $env:ORG_GRADLE_PROJECT_ANA_RUTAS_SERVER_URL)
$ErrorActionPreference = 'Stop'
# All mechanical mutations happen in an isolated temporary copy, never in the checkout.
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$workRoot = Join-Path ([IO.Path]::GetTempPath()) ('ana-rutas-workspace-mutations-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workRoot | Out-Null
foreach ($entry in @('gradle', 'gradlew', 'gradlew.bat', 'build.gradle.kts', 'settings.gradle.kts', 'gradle.properties')) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot $entry) -Destination $workRoot -Recurse
}
New-Item -ItemType Directory -Path (Join-Path $workRoot 'app') | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceRoot 'app/build.gradle.kts') -Destination (Join-Path $workRoot 'app')
Copy-Item -LiteralPath (Join-Path $sourceRoot 'app/src') -Destination (Join-Path $workRoot 'app') -Recurse
$policy = Join-Path $workRoot 'app/src/main/java/com/five/anarutas/driver/DriverDashboardPolicy.kt'
$original = [IO.File]::ReadAllText($policy)
$cases = @(
    @{ name = 'allow_previous_day'; from = 'route.date == serviceDate'; to = 'true' },
    @{ name = 'allow_started_route'; from = 'route.startedAt == null'; to = 'true' },
    @{ name = 'allow_four_photos'; from = 'route!!.photoCount >= 5'; to = 'route!!.photoCount >= 4' },
    @{ name = 'allow_empty_route'; from = 'route.orders.isNotEmpty()'; to = 'true' },
    @{ name = 'allow_stale_route'; from = 'route.routeStatus == "current"'; to = 'true' },
    @{ name = 'map_uses_historical_selection'; from = 'dashboard?.today?.takeIf'; to = '(selected ?: dashboard?.today)?.takeIf' },
    @{ name = 'search_no_trim'; from = 'val term = query.trim()'; to = 'val term = query' },
    @{ name = 'search_case_sensitive'; from = 'ignoreCase = true'; to = 'ignoreCase = false' }
)
$arguments = @('testDebugUnitTest', '--tests', 'com.five.anarutas.driver.DriverWorkspacePolicyTest', '--console=plain')
if ($ServerUrl) { $arguments += ('-PANA_RUTAS_SERVER_URL=' + $ServerUrl) }
Push-Location $workRoot
try {
    & .\gradlew.bat @arguments *> (Join-Path $workRoot 'baseline.log')
    if ($LASTEXITCODE -ne 0) { throw "Baseline failed; inspect $workRoot/baseline.log" }
    $results = @()
    foreach ($case in $cases) {
        if (!$original.Contains($case.from)) { throw ('Mutation anchor missing: ' + $case.name) }
        [IO.File]::WriteAllText($policy, $original.Replace($case.from, $case.to), [Text.UTF8Encoding]::new($false))
        $report = Join-Path $workRoot 'app/build/test-results/testDebugUnitTest/TEST-com.five.anarutas.driver.DriverWorkspacePolicyTest.xml'
        if (Test-Path -LiteralPath $report) { Remove-Item -LiteralPath $report }
        & .\gradlew.bat @arguments *> (Join-Path $workRoot ($case.name + '.log'))
        $exitCode = $LASTEXITCODE
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
    [IO.File]::WriteAllText($policy, $original, [Text.UTF8Encoding]::new($false))
    Pop-Location
}
