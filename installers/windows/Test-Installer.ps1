param([switch]$RecoveryOnly)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$installer = Join-Path $PSScriptRoot 'Install-FindCheap-Agent.ps1'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw 'Installer parse failed.' }
# Load only function definitions; never execute the real installation entry point.
foreach ($definition in $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
  . ([scriptblock]::Create($definition.Extent.Text))
}
function Assert-True($Value, $Message) { if (-not $Value) { throw $Message } }
function Assert-Throws([scriptblock]$Action, $Message) {
  $threw = $false
  try { & $Action } catch { $threw = $true }
  Assert-True $threw $Message
}
function Assert-ThrowsMatching([scriptblock]$Action, [string[]]$Patterns) {
  $failure = $null
  try { & $Action } catch { $failure = $_.Exception.Message }
  Assert-True ($null -ne $failure) 'Expected the simulated CLI or recovery failure.'
  foreach ($pattern in $Patterns) {
    Assert-True ($failure -match $pattern) "Expected error matching '$pattern', received: $failure"
  }
}
function Write-Fixture($Path, $Text) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
  [IO.File]::WriteAllText($Path, $Text)
}
function Write-InstallerLog { param($Message, $Level = 'INFO') }
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('FindCheap-installer-test-' + [guid]::NewGuid().ToString('N'))
$StateRoot = Join-Path $fixtureRoot 'state'
$cacheRoot = Join-Path $fixtureRoot 'cache'
$oldFile = Join-Path $cacheRoot '0.1.0/dist/main.cjs'
Write-Fixture $oldFile 'exact old runtime'
$oldConfig = Join-Path $cacheRoot '0.1.0/config.json'
Write-Fixture $oldConfig 'exact old config'
$snapshot = Save-PluginCache -CacheRoot $cacheRoot
Remove-Item -LiteralPath $oldFile
Restore-MissingPluginCacheFiles -Snapshot $snapshot
Assert-True (([IO.File]::ReadAllText($oldFile)) -ceq 'exact old runtime') 'A missing previous runtime was not restored.'
Write-Fixture $oldFile 'concurrently changed runtime'
Remove-Item -LiteralPath $oldConfig
Assert-Throws { Restore-MissingPluginCacheFiles -Snapshot $snapshot } 'A changed file must not silently pass restoration.'
Assert-True (([IO.File]::ReadAllText($oldFile)) -ceq 'concurrently changed runtime') 'Restore overwrote a changed file.'
Assert-True (([IO.File]::ReadAllText($oldConfig)) -ceq 'exact old config') 'A conflicting file prevented recovery of unrelated missing files.'
Assert-Throws { Get-CacheFilePath -Root $cacheRoot -RelativePath '../escape.txt' } 'Traversal must be rejected.'

$MarketplaceName = 'findcheap-agent'
$MarketplaceRepository = 'yyq8548/FindCheap-Agent'
$sourceRoot = Join-Path $fixtureRoot 'marketplace'
$newRoot = Join-Path $cacheRoot '0.2.0'
$script:scenario = ''
$script:commands = @()
function Reset-UpgradeFixture([string]$Scenario) {
  Write-Fixture $oldFile 'exact old runtime'
  Write-Fixture $oldConfig 'exact old config'
  $script:scenario = $Scenario
  $script:commands = @()
}
function Invoke-Codex {
  param($CodexCommand, $Arguments, [switch]$AllowFailure)
  $command = $Arguments -join ' '
  $script:commands += $command
  switch ($command) {
    'plugin marketplace upgrade findcheap-agent' {
      # The first marketplace mutation can remove entries still used by the host.
      Remove-Item -LiteralPath $oldFile
      Remove-Item -LiteralPath $oldConfig
      Write-Fixture (Join-Path $cacheRoot '0.2.0/dist/main.cjs') 'new runtime'
      if ($script:scenario -like 'verify-*') {
        foreach ($root in @($sourceRoot, $newRoot)) {
          Write-Fixture (Join-Path $root '.codex-plugin/plugin.json') '{"name":"findcheap-agent","version":"0.2.0"}'
          Write-Fixture (Join-Path $root 'dist/main.cjs') 'new runtime'
        }
        if ($script:scenario -eq 'verify-old') {
          Write-Fixture (Join-Path $cacheRoot '0.1.0/.codex-plugin/plugin.json') '{"name":"findcheap-agent","version":"0.1.0"}'
          Write-Fixture $oldFile 'exact old runtime'
        }
        if ($script:scenario -eq 'verify-corrupt') { Write-Fixture (Join-Path $newRoot 'dist/main.cjs') 'corrupt' }
      }
      if ($script:scenario -eq 'upgrade-exception') { throw 'fixture marketplace upgrade native exception' }
      if ($script:scenario -like 'fallback-*') { return 7 }
      return 0
    }
    'plugin marketplace add yyq8548/FindCheap-Agent --ref main' {
      Assert-True (-not $AllowFailure) 'Fallback failure must propagate.'
      if ($script:scenario -eq 'fallback-failure') { throw 'fixture marketplace add failed (exit 9)' }
      return 0
    }
    'plugin add findcheap-agent@findcheap-agent' {
      Assert-True ($script:commands.Count -ge 2) 'Plugin add ran without the marketplace mutation inside the protected scope.'
      if ($script:scenario -eq 'plugin-exception') { throw 'fixture plugin add native exception' }
      if ($script:scenario -eq 'recovery-conflict') {
        Write-Fixture $oldFile 'concurrently changed runtime'
        return 13
      }
      if ($script:scenario -eq 'plugin-failure' -or $script:scenario -like 'verify-*') { return 13 }
      return 0
    }
    default { throw "Unexpected fixture command: $command" }
  }
}
function Get-InstalledPluginVersion {
  param($CodexCommand, $CacheRoot)
  if ($script:scenario -notlike 'verify-*') { throw 'fixture plugin is not yet installed and verified' }
  $version = if ($script:scenario -eq 'verify-old') { '0.1.0' } else { '0.2.0' }
  $installedState = [pscustomobject]@{
    pluginId = 'findcheap-agent@findcheap-agent'; installed = $true
    enabled = ($script:scenario -ne 'verify-disabled'); version = $version
    source = [pscustomobject]@{ path = $sourceRoot }
  }
  return Test-InstalledPlugin -Installed $installedState -CacheRoot $CacheRoot
}
function Assert-UpgradeRecovery {
  Assert-True (([IO.File]::ReadAllText($oldFile)) -ceq 'exact old runtime') 'Marketplace mutation destroyed the running entry point.'
  Assert-True (([IO.File]::ReadAllText($oldConfig)) -ceq 'exact old config') 'Marketplace mutation destroyed the previous configuration.'
  Assert-True (([IO.File]::ReadAllText((Join-Path $cacheRoot '0.2.0/dist/main.cjs'))) -ceq 'new runtime') 'Old recovery overwrote the new version.'
}
Reset-UpgradeFixture 'plugin-failure'
Assert-ThrowsMatching { Install-CodexPlugin -CodexCommand 'fixture' -CacheRoot $cacheRoot } @('installation failed \(exit 13\)')
Assert-UpgradeRecovery
Assert-True (($script:commands -join ';') -ceq 'plugin marketplace upgrade findcheap-agent;plugin add findcheap-agent@findcheap-agent') 'Upgrade and plugin add must run once in order.'
foreach ($scenario in @('success', 'fallback-success')) {
  Reset-UpgradeFixture $scenario
  Install-CodexPlugin -CodexCommand 'fixture' -CacheRoot $cacheRoot
  Assert-UpgradeRecovery
  $expected = if ($scenario -eq 'success') { 2 } else { 3 }
  Assert-True ($script:commands.Count -eq $expected) 'Successful upgrade used an unexpected command sequence.'
}
Reset-UpgradeFixture 'fallback-failure'
Assert-ThrowsMatching { Install-CodexPlugin -CodexCommand 'fixture' -CacheRoot $cacheRoot } @('fixture marketplace add failed \(exit 9\)')
Assert-UpgradeRecovery
Assert-True (($script:commands -join ';') -ceq 'plugin marketplace upgrade findcheap-agent;plugin marketplace add yyq8548/FindCheap-Agent --ref main') 'Plugin add must not run after fallback failure.'
foreach ($scenario in @('upgrade-exception', 'plugin-exception')) {
  Reset-UpgradeFixture $scenario
  $stage = if ($scenario -eq 'upgrade-exception') { 'marketplace upgrade' } else { 'plugin add' }
  Assert-ThrowsMatching { Install-CodexPlugin -CodexCommand 'fixture' -CacheRoot $cacheRoot } @("fixture $stage native exception")
  Assert-UpgradeRecovery
}
Reset-UpgradeFixture 'recovery-conflict'
Assert-ThrowsMatching { Install-CodexPlugin -CodexCommand 'fixture' -CacheRoot $cacheRoot } @('installation failed \(exit 13\)', 'Cache recovery also failed', 'Existing plugin files changed')
Assert-True (([IO.File]::ReadAllText($oldFile)) -ceq 'concurrently changed runtime') 'Recovery overwrote a concurrent change.'
Assert-True (([IO.File]::ReadAllText($oldConfig)) -ceq 'exact old config') 'Primary failure or conflict prevented restoration of another missing file.'
Reset-UpgradeFixture 'verify-current'
Install-CodexPlugin -CodexCommand 'fixture' -CacheRoot $cacheRoot
Assert-UpgradeRecovery
Assert-True (($script:commands -join ';') -ceq 'plugin marketplace upgrade findcheap-agent') 'An installed, enabled, exact current distribution must skip redundant plugin add.'
foreach ($scenario in @('verify-old', 'verify-corrupt', 'verify-disabled')) {
  Reset-UpgradeFixture $scenario
  Assert-ThrowsMatching { Install-CodexPlugin -CodexCommand 'fixture' -CacheRoot $cacheRoot } @('installation failed \(exit 13\)')
  Assert-True (($script:commands -join ';') -ceq 'plugin marketplace upgrade findcheap-agent;plugin add findcheap-agent@findcheap-agent') 'An old, corrupt or disabled package must still attempt installation and preserve CLI failure.'
  Assert-True (([IO.File]::ReadAllText($oldFile)) -ceq 'exact old runtime') 'Verification fallback failed to preserve the previous runtime.'
  Assert-True (([IO.File]::ReadAllText($oldConfig)) -ceq 'exact old config') 'Verification fallback failed to preserve the previous configuration.'
  # Reset only this test-owned file before the next independent snapshot.
  Write-Fixture (Join-Path $newRoot 'dist/main.cjs') 'new runtime'
}
Write-Fixture $oldFile 'exact old runtime'
if ($RecoveryOnly) { Write-Host 'PASS: marketplace and plugin mutations preserve previous cache on success, CLI failure, exceptions and recovery conflict.'; return }

$sourceRoot = Join-Path $fixtureRoot 'marketplace'
$newRoot = Join-Path $cacheRoot '0.2.0'
foreach ($root in @($sourceRoot, $newRoot)) {
  Write-Fixture (Join-Path $root '.codex-plugin/plugin.json') '{"name":"findcheap-agent","version":"0.2.0"}'
  Write-Fixture (Join-Path $root 'dist/main.cjs') 'new runtime'
}
$installed = [pscustomobject]@{ pluginId = 'findcheap-agent@findcheap-agent'; installed = $true; enabled = $true; version = '0.2.0'; source = [pscustomobject]@{ path = $sourceRoot } }
$version = Test-InstalledPlugin -Installed $installed -CacheRoot $cacheRoot
Assert-True ($version -eq '0.2.0') 'Installed status must select the current version.'
$extraSkill = Join-Path $newRoot 'skills/unexpected/SKILL.md'
Write-Fixture $extraSkill 'unexpected executable instructions'
Assert-Throws { Test-InstalledPlugin -Installed $installed -CacheRoot $cacheRoot } 'Extra cached executable content must fail integrity verification.'
Remove-Item -LiteralPath $extraSkill
$installed.enabled = $false
Assert-Throws { Test-InstalledPlugin -Installed $installed -CacheRoot $cacheRoot } 'Disabled plugin must not count as installed and enabled.'
$installed.enabled = $true
Write-Fixture (Join-Path $newRoot 'dist/main.cjs') 'corrupt'
Assert-Throws { Test-InstalledPlugin -Installed $installed -CacheRoot $cacheRoot } 'Hash mismatch must fail.'
Remove-Item -LiteralPath (Join-Path $newRoot 'dist/main.cjs')
Assert-Throws { Test-InstalledPlugin -Installed $installed -CacheRoot $cacheRoot } 'Missing runtime must fail.'
$installed.version = '../outside'
Assert-Throws { Test-InstalledPlugin -Installed $installed -CacheRoot $cacheRoot } 'Unsafe version must fail.'

# A junction is available to ordinary Windows users and must never be traversed.
if ($env:OS -eq 'Windows_NT') {
  $outsideRoot = Join-Path $fixtureRoot 'outside'
  New-Item -ItemType Directory -Path $outsideRoot -Force | Out-Null
  New-Item -ItemType Junction -Path (Join-Path $cacheRoot 'linked') -Target $outsideRoot | Out-Null
  Assert-Throws { Save-PluginCache -CacheRoot $cacheRoot } 'Reparse points must not enter a backup.'
  Assert-Throws { Get-CacheFilePath -Root $cacheRoot -RelativePath 'linked/out.txt' } 'Restore must not follow a reparse point.'
}
Write-Host "PASS: installer recovery, concurrent edits, canonical status, integrity and path isolation. Fixtures: $fixtureRoot"
