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

Write-Fixture $oldFile 'exact old runtime'
$script:simulateExit = 1
function Invoke-Codex {
  param($CodexCommand, $Arguments, [switch]$AllowFailure)
  Remove-Item -LiteralPath $oldFile
  Write-Fixture (Join-Path $cacheRoot '0.2.0/dist/main.cjs') 'new runtime'
  return $script:simulateExit
}
Assert-Throws { Install-CodexPlugin -CodexCommand 'fixture' -CacheRoot $cacheRoot } 'CLI failure must remain failure after successful recovery.'
Assert-True (([IO.File]::ReadAllText($oldFile)) -ceq 'exact old runtime') 'A failed upgrade destroyed the running entry point.'
$script:simulateExit = 0
Install-CodexPlugin -CodexCommand 'fixture' -CacheRoot $cacheRoot
Assert-True (([IO.File]::ReadAllText($oldFile)) -ceq 'exact old runtime') 'Successful upgrade did not preserve an existing host entry point.'
Assert-True (([IO.File]::ReadAllText((Join-Path $cacheRoot '0.2.0/dist/main.cjs'))) -ceq 'new runtime') 'Old recovery overwrote the new version.'
if ($RecoveryOnly) { Write-Host 'PASS: previous cache survives failed and successful CLI upgrades.'; return }

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
