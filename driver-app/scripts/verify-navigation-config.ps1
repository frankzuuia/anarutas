$ErrorActionPreference = 'Stop'
# Real Gradle configuration checks. No ADB, HTTP stubs or navigation requests.
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$localSource = Join-Path $sourceRoot 'navigation.local.properties'
if (!(Test-Path -LiteralPath $localSource)) { throw 'Configure the local navigation key before running this gate' }
$localText = [IO.File]::ReadAllText($localSource)
$localSettings = ConvertFrom-StringData $localText
$expectedKey = $localSettings.ANA_RUTAS_NAVIGATION_API_KEY
$serverOrigin = $localSettings.ANA_RUTAS_SERVER_URL
if (!$expectedKey -or !$serverOrigin) { throw 'Incomplete local navigation configuration' }
$workRoot = Join-Path ([IO.Path]::GetTempPath()) ('ana-rutas-navigation-config-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workRoot | Out-Null
# The isolated build contains the real restricted SDK key: protect it before copying.
$acl = [Security.AccessControl.DirectorySecurity]::new()
$acl.SetAccessRuleProtection($true, $false)
$owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl.SetOwner($owner)
foreach ($sid in @($owner, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
}
Set-Acl -LiteralPath $workRoot -AclObject $acl
foreach ($entry in @('gradle', 'gradlew', 'gradlew.bat', 'build.gradle.kts', 'settings.gradle.kts', 'gradle.properties')) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot $entry) -Destination $workRoot -Recurse
}
New-Item -ItemType Directory -Path (Join-Path $workRoot 'app') | Out-Null
foreach ($entry in @('build.gradle.kts', 'google-services.json', 'src')) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot ('app/' + $entry)) -Destination (Join-Path $workRoot 'app') -Recurse
}
$buildFile = Join-Path $workRoot 'app/build.gradle.kts'
$original = [IO.File]::ReadAllText($buildFile)
$localCopy = Join-Path $workRoot 'navigation.local.properties'
$generated = Join-Path $workRoot 'app/build/generated/source/buildConfig/debug/com/five/anarutas/driver/BuildConfig.java'
$previousKeyEnvironment = $env:ORG_GRADLE_PROJECT_ANA_RUTAS_NAVIGATION_API_KEY
$previousServerEnvironment = $env:ORG_GRADLE_PROJECT_ANA_RUTAS_SERVER_URL
$env:ORG_GRADLE_PROJECT_ANA_RUTAS_NAVIGATION_API_KEY = $null
$env:ORG_GRADLE_PROJECT_ANA_RUTAS_SERVER_URL = $serverOrigin
function Test-ConfigurationCase([string]$Name, [string[]]$Options, [string]$ExpectedValue, [string]$ExpectedError) {
    $log = Join-Path $workRoot ($Name + '.log')
    & .\gradlew.bat generateDebugBuildConfig --console=plain @Options *> $log
    $code = $LASTEXITCODE
    if ($ExpectedError) {
        return $code -ne 0 -and ([IO.File]::ReadAllText($log)).Contains($ExpectedError)
    }
    return $code -eq 0 -and (Test-Path -LiteralPath $generated) -and ([IO.File]::ReadAllText($generated)).Contains('NAVIGATION_API_KEY = "' + $ExpectedValue + '";')
}
$cases = @(
    @{ name = 'local_key'; expected = $expectedKey },
    @{ name = 'explicit_empty_override'; options = @('-PANA_RUTAS_NAVIGATION_API_KEY='); expected = '' },
    @{ name = 'invalid_key'; options = @('-PANA_RUTAS_NAVIGATION_API_KEY=invalid key!'); error = 'ANA_RUTAS_NAVIGATION_API_KEY contains invalid characters' },
    @{ name = 'other_server'; options = @('-PANA_RUTAS_SERVER_URL=https://navigation-config.invalid'); error = 'Local navigation configuration belongs to another server' },
    @{ name = 'explicit_other_server_without_navigation'; options = @('-PANA_RUTAS_SERVER_URL=https://navigation-config.invalid', '-PANA_RUTAS_NAVIGATION_API_KEY='); expected = '' },
    @{ name = 'missing_local_key'; missing = $true; error = 'Local navigation configuration is missing ANA_RUTAS_NAVIGATION_API_KEY' }
)
$mutations = @(
    @{ name = 'skip_server_binding'; case = 'other_server'; from = 'configuration.getProperty("ANA_RUTAS_SERVER_URL") == driverServerUrl'; to = 'true' },
    @{ name = 'ignore_local_configuration'; case = 'local_key'; from = '.orElse(localNavigationKey).orElse("")'; to = '.orElse("").orElse(localNavigationKey)' },
    @{ name = 'ignore_explicit_override'; case = 'explicit_empty_override'; from = 'val navigationKey = providers.gradleProperty("ANA_RUTAS_NAVIGATION_API_KEY")'; to = 'val navigationKey = localNavigationKey' },
    @{ name = 'skip_key_validation'; case = 'invalid_key'; from = "navigationKey.all { it.isLetterOrDigit() || it == '-' || it == '_' }"; to = 'true' },
    @{ name = 'allow_missing_local_key'; case = 'missing_local_key'; from = 'requireNotNull(configuration.getProperty("ANA_RUTAS_NAVIGATION_API_KEY"))'; to = 'requireNotNull(configuration.getProperty("ANA_RUTAS_NAVIGATION_API_KEY", ""))' }
)
Push-Location $workRoot
try {
    $baseline = @()
    $withoutFile = Test-ConfigurationCase -Name 'absent_configuration' -ExpectedValue ''
    $baseline += [pscustomobject]@{ name = 'absent_configuration'; passed = $withoutFile }
    if (!$withoutFile) { throw 'Absent-configuration baseline failed' }
    foreach ($case in $cases) {
        $text = if ($case.missing) { 'ANA_RUTAS_SERVER_URL=' + $serverOrigin } else { $localText }
        [IO.File]::WriteAllText($localCopy, $text, [Text.UTF8Encoding]::new($false))
        $passed = Test-ConfigurationCase -Name $case.name -Options $case.options -ExpectedValue $case.expected -ExpectedError $case.error
        $baseline += [pscustomobject]@{ name = $case.name; passed = $passed }
        Write-Output ($case.name + ': ' + $(if ($passed) { 'PASSED' } else { 'FAILED' }))
        if (!$passed) { throw ('Configuration baseline failed: ' + $case.name) }
    }
    $mutationResults = @()
    foreach ($mutation in $mutations) {
        if (!$original.Contains($mutation.from)) { throw ('Mutation anchor missing: ' + $mutation.name) }
        $case = $cases | Where-Object name -eq $mutation.case
        $text = if ($case.missing) { 'ANA_RUTAS_SERVER_URL=' + $serverOrigin } else { $localText }
        [IO.File]::WriteAllText($localCopy, $text, [Text.UTF8Encoding]::new($false))
        [IO.File]::WriteAllText($buildFile, $original.Replace($mutation.from, $mutation.to), [Text.UTF8Encoding]::new($false))
        $survived = Test-ConfigurationCase -Name $mutation.name -Options $case.options -ExpectedValue $case.expected -ExpectedError $case.error
        $exitCode = $LASTEXITCODE
        # A syntax/infrastructure failure is not a killed mutation.
        $validExecution = $exitCode -eq 0 -or ($case.error -and ([IO.File]::ReadAllText((Join-Path $workRoot ($mutation.name + '.log')))).Contains($case.error))
        $killed = !$survived -and $validExecution
        $mutationResults += [pscustomobject]@{ name = $mutation.name; killed = $killed }
        Write-Output ($mutation.name + ': ' + $(if ($killed) { 'KILLED' } else { 'SURVIVED / INFRA FAILURE' }))
    }
    [pscustomobject]@{ baseline = $baseline; mutations = $mutationResults } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $workRoot 'results.json')
    Write-Output ('Evidence: ' + $workRoot)
    if (@($mutationResults | Where-Object { !$_.killed }).Count) { throw 'Navigation configuration mutation gate failed' }
} finally {
    [IO.File]::WriteAllText($buildFile, $original, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($localCopy, $localText, [Text.UTF8Encoding]::new($false))
    $env:ORG_GRADLE_PROJECT_ANA_RUTAS_NAVIGATION_API_KEY = $previousKeyEnvironment
    $env:ORG_GRADLE_PROJECT_ANA_RUTAS_SERVER_URL = $previousServerEnvironment
    Pop-Location
}
