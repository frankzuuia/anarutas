param([string[]]$Only = @())
$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskTempRoot = [IO.Path]::GetTempPath()
$workRoot = Join-Path $taskTempRoot ('ana-rutas-incident-organization-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workRoot | Out-Null
foreach ($entry in @('gradle', 'gradlew', 'gradlew.bat', 'build.gradle.kts', 'settings.gradle.kts', 'gradle.properties')) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot $entry) -Destination $workRoot -Recurse
}
New-Item -ItemType Directory -Path (Join-Path $workRoot 'app') | Out-Null
foreach ($entry in @('build.gradle.kts', 'google-services.json', 'src')) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot ('app/' + $entry)) -Destination (Join-Path $workRoot 'app') -Recurse
}
$cases = @(
    @{name='return_requires_classification'; from='kind != ProductIncidentKind.RETURN'; to='true'},
    @{name='shortages_skip_classification'; from='!productClassificationRequired(kind) ||'; to='true ||'},
    @{name='accept_invalid_department'; from='department in productDepartments &&'; to='true &&'},
    @{name='accept_invalid_concept'; from='concept in productConcepts'; to='true'},
    @{name='remove_purchase_error'; from=', "Error en compra")'; to=')'},
    @{name='validation_loses_late'; from='listOf(ProductComment.MISSING, ProductComment.LATE)'; to='listOf(ProductComment.MISSING)'},
    @{name='return_offers_special'; from='listOf(ProductComment.SPECIFICATIONS, ProductComment.QUALITY, ProductComment.DAMAGED)'; to='listOf(ProductComment.SPECIAL, ProductComment.QUALITY, ProductComment.DAMAGED)'},
    @{name='accept_foreign_comment'; from='comments.all { code ->'; to='comments.any { code ->'},
    @{name='lose_pending_v2_photos'; from='formVersion == 2 || formVersion == 3'; to='formVersion == 3'},
    @{name='lose_new_v3_photos'; from='formVersion == 2 || formVersion == 3'; to='formVersion == 2'},
    @{name='return_without_photo'; from='internal fun productEvidenceRequired(kind: ProductIncidentKind) = !kind.manual'; to='internal fun productEvidenceRequired(kind: ProductIncidentKind) = !kind.manual && kind != ProductIncidentKind.RETURN'},
    @{name='allow_four_photos'; from='else 0)..3'; to='else 0)..4'}
)
if ($Only.Count) {
    $cases = @($cases | Where-Object { $Only -contains $_.name })
    if ($cases.Count -ne $Only.Count) { throw 'Unknown mutation filter' }
}
$policy = Join-Path $workRoot 'app/src/main/java/com/five/anarutas/driver/ProductIncidentPolicy.kt'
$original = [IO.File]::ReadAllText($policy)
$arguments = @('testDebugUnitTest', '--tests', 'com.five.anarutas.driver.ProductIncidentPolicyTest', '--console=plain')
$results = @()
Push-Location $workRoot
try {
    & .\gradlew.bat @arguments *> (Join-Path $workRoot 'baseline.log')
    if ($LASTEXITCODE -ne 0) { throw "Mutation baseline failed: $workRoot/baseline.log" }
    foreach ($case in $cases) {
        if ($original.Split($case.from).Count -ne 2) { throw ('Non-unique anchor: ' + $case.name) }
        [IO.File]::WriteAllText($policy, $original.Replace($case.from, $case.to), [Text.UTF8Encoding]::new($false))
        $report = Join-Path $workRoot 'app/build/test-results/testDebugUnitTest/TEST-com.five.anarutas.driver.ProductIncidentPolicyTest.xml'
        if (Test-Path -LiteralPath $report) { Remove-Item -LiteralPath $report }
        & .\gradlew.bat @arguments *> (Join-Path $workRoot ($case.name + '.log'))
        $resultCode = $LASTEXITCODE
        if (!(Test-Path -LiteralPath $report)) { throw ('Missing test execution: ' + $case.name) }
        [xml]$xml = Get-Content -LiteralPath $report -Raw
        $result = [PSCustomObject]@{ name=$case.name; killed=($resultCode -ne 0 -and [int]$xml.testsuite.failures -gt 0); failures=[int]$xml.testsuite.failures }
        $results += $result
        $result | ConvertTo-Json -Compress
        [IO.File]::WriteAllText($policy, $original, [Text.UTF8Encoding]::new($false))
    }
    $results | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $sourceRoot '../.local/io-apk-mutations.json')
    if ($results.Where({ !$_.killed }).Count) { throw 'Incident mutation survived' }
} finally {
    Pop-Location
    $resolved = [IO.Path]::GetFullPath($workRoot)
    if (!$resolved.StartsWith([IO.Path]::GetFullPath($taskTempRoot), [StringComparison]::OrdinalIgnoreCase) -or
        ![IO.Path]::GetFileName($resolved).StartsWith('ana-rutas-incident-organization-')) { throw 'Unsafe cleanup path' }
    # Keep logs on failure; remove only the verified isolated checkout on success.
    if ($results.Count -eq $cases.Count -and !$results.Where({ !$_.killed }).Count) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
