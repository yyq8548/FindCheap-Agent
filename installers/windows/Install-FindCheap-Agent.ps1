[CmdletBinding()]
param(
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$InstallerVersion = "1.2.0"
$MarketplaceName = "findcheap-agent"
$MarketplaceRepository = "yyq8548/FindCheap-Agent"
$PluginReference = "findcheap-agent@findcheap-agent"
$StateRoot = Join-Path $env:LOCALAPPDATA "FindCheapAgent"
$LogPath = Join-Path $StateRoot "install.log"

function Write-InstallerLog {
  param(
    [Parameter(Mandatory)] [string]$Message,
    [ValidateSet("INFO", "OK", "WARN", "ERROR")] [string]$Level = "INFO"
  )

  $line = "[{0}] [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
  Write-Host $line
  if (-not $DryRun) {
    Add-Content -LiteralPath $LogPath -Value $line -Encoding utf8
  }
}

function Get-Node24Command {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($null -eq $command) {
    return $null
  }

  try {
    $version = (& $command.Source --version 2>$null).Trim()
    if ($version -match '^v24\.') {
      return $command.Source
    }
  } catch {
    return $null
  }

  return $null
}

function Add-DirectoryToUserPath {
  param([Parameter(Mandatory)] [string]$Directory)

  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $entries = @($userPath -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  $normalizedDirectory = $Directory.TrimEnd('\')
  $alreadyPresent = $entries | Where-Object { $_.TrimEnd('\') -ieq $normalizedDirectory }
  if ($null -eq $alreadyPresent) {
    $updated = (@($Directory) + $entries) -join ';'
    [Environment]::SetEnvironmentVariable("Path", $updated, "User")
  }
  $env:Path = "$Directory;$env:Path"
}

function Install-PortableNode24 {
  Write-InstallerLog "Node.js 24 was not found. Installing the official portable runtime."

  $checksumsUri = "https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt"
  $checksums = (Invoke-WebRequest -UseBasicParsing -Uri $checksumsUri).Content
  $archiveCandidate = $checksums -split "`n" |
    Where-Object { $_ -match 'node-v24\.[0-9]+\.[0-9]+-win-x64\.zip$' } |
    Select-Object -First 1
  if ([string]::IsNullOrWhiteSpace($archiveCandidate)) {
    throw "Unable to resolve the current Node.js 24 Windows archive."
  }
  $archiveLine = $archiveCandidate.Trim()
  if ($archiveLine -notmatch '^([a-fA-F0-9]{64})\s+(node-v24\.[0-9]+\.[0-9]+-win-x64\.zip)$') {
    throw "Unable to resolve the current Node.js 24 Windows archive."
  }

  $expectedHash = $Matches[1].ToUpperInvariant()
  $archiveName = $Matches[2]
  $runtimeName = [IO.Path]::GetFileNameWithoutExtension($archiveName)
  $runtimeRoot = Join-Path $StateRoot "runtime"
  $runtimeDirectory = Join-Path $runtimeRoot $runtimeName
  $archivePath = Join-Path $env:TEMP ("FindCheap-{0}" -f $archiveName)
  $extractRoot = Join-Path $env:TEMP ("FindCheap-Node-{0}" -f [guid]::NewGuid().ToString("N"))

  if (-not (Test-Path -LiteralPath (Join-Path $runtimeDirectory "node.exe"))) {
    if (Test-Path -LiteralPath $runtimeDirectory) {
      $runtimeDirectory = Join-Path $runtimeRoot ("{0}-{1}" -f $runtimeName, [guid]::NewGuid().ToString("N"))
    }
    $archiveUri = "https://nodejs.org/dist/latest-v24.x/$archiveName"
    Write-InstallerLog "Downloading $archiveName from nodejs.org."
    Invoke-WebRequest -UseBasicParsing -Uri $archiveUri -OutFile $archivePath

    $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
    if ($actualHash -ne $expectedHash) {
      throw "Node.js archive checksum verification failed."
    }

    New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot -Force
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    Move-Item -LiteralPath (Join-Path $extractRoot $runtimeName) -Destination $runtimeDirectory
  }

  if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
  }
  if (Test-Path -LiteralPath $extractRoot) {
    Remove-Item -LiteralPath $extractRoot -Recurse -Force
  }

  Add-DirectoryToUserPath -Directory $runtimeDirectory
  $nodeCommand = Join-Path $runtimeDirectory "node.exe"
  $version = (& $nodeCommand --version).Trim()
  Write-InstallerLog "Installed Node.js $version." "OK"
  return $nodeCommand
}

function Find-CodexCommand {
  $codexRoot = if ([string]::IsNullOrWhiteSpace($env:CODEX_HOME)) {
    Join-Path $env:USERPROFILE ".codex"
  } else {
    $env:CODEX_HOME
  }
  $appserverCommand = Join-Path $codexRoot "plugins\.plugin-appserver\codex.exe"
  if (Test-Path -LiteralPath $appserverCommand) {
    return $appserverCommand
  }

  $command = Get-Command codex.exe -ErrorAction SilentlyContinue
  if ($null -ne $command) {
    return $command.Source
  }

  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps\codex.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Codex\codex.exe")
  )

  try {
    $package = Get-AppxPackage -Name "OpenAI.Codex" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $package) {
      $candidates += Join-Path $package.InstallLocation "app\resources\codex.exe"
    }
  } catch {
    Write-InstallerLog "Could not inspect the Codex AppX package." "WARN"
  }

  return $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

function Invoke-Codex {
  param(
    [Parameter(Mandatory)] [string]$CodexCommand,
    [Parameter(Mandatory)] [string[]]$Arguments,
    [switch]$AllowFailure
  )

  Write-InstallerLog ("Running: codex {0}" -f ($Arguments -join ' '))
  & $CodexCommand @Arguments 2>&1 | ForEach-Object {
    Write-Host $_
    Add-Content -LiteralPath $LogPath -Value $_ -Encoding utf8
  }
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0 -and -not $AllowFailure) {
    throw "Codex command failed with exit code $exitCode."
  }
  return $exitCode
}

function Get-CacheFilePath {
  param([string]$Root, [string]$RelativePath)

  $base = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
  $target = [IO.Path]::GetFullPath((Join-Path $base $RelativePath))
  if (-not $target.StartsWith($base + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Plugin cache path is outside its expected directory."
  }
  $current = $target
  while ($current.Length -ge $base.Length) {
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Plugin cache reparse points are not supported: $current"
      }
    }
    if ($current -eq $base) { break }
    $current = Split-Path -Parent $current
  }
  return $target
}

function Get-PluginFiles {
  param([string]$Root)

  if (-not (Test-Path -LiteralPath $Root)) { return }
  $base = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
  $pending = [Collections.Generic.Stack[string]]::new()
  $pending.Push($base)
  while ($pending.Count -gt 0) {
    $directory = $pending.Pop()
    if ((Get-Item -LiteralPath $directory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw "Plugin directories must not be reparse points: $directory"
    }
    foreach ($item in Get-ChildItem -LiteralPath $directory -Force) {
      $relative = $item.FullName.Substring($base.Length + 1)
      $null = Get-CacheFilePath -Root $base -RelativePath $relative
      if ($item.PSIsContainer) { $pending.Push($item.FullName) }
      else { $relative }
    }
  }
}

function Save-PluginCache {
  param([string]$CacheRoot)

  $backupRoot = Join-Path $StateRoot ('cache-backups\' + [guid]::NewGuid().ToString('N'))
  $files = @()
  foreach ($relative in @(Get-PluginFiles -Root $CacheRoot)) {
    $source = Get-CacheFilePath -Root $CacheRoot -RelativePath $relative
    $destination = Get-CacheFilePath -Root $backupRoot -RelativePath $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    $beforeHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    Copy-Item -LiteralPath $source -Destination $destination
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $beforeHash -or
        (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $beforeHash) {
      throw "Plugin cache changed during backup; installation has not started."
    }
    $files += [pscustomobject]@{ relativePath = $relative; sha256 = $beforeHash }
  }
  $snapshot = [pscustomobject]@{ cacheRoot = $CacheRoot; backupRoot = $backupRoot; files = $files }
  New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
  $snapshot | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $backupRoot 'recovery.json') -Encoding utf8
  Write-InstallerLog "Previous plugin files backed up: $backupRoot"
  return $snapshot
}

function Restore-MissingPluginCacheFiles {
  param($Snapshot)

  $conflicts = @()
  foreach ($file in $Snapshot.files) {
    $destination = Get-CacheFilePath -Root $Snapshot.cacheRoot -RelativePath $file.relativePath
    if (Test-Path -LiteralPath $destination) {
      if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $file.sha256) {
        $conflicts += $file.relativePath
      }
      continue
    }
    $source = Get-CacheFilePath -Root $Snapshot.backupRoot -RelativePath $file.relativePath
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $file.sha256) {
      throw "Plugin recovery backup failed integrity verification."
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    # CreateNew refuses to overwrite a file created by another installer after the existence check.
    $stream = [IO.File]::Open($destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
      $bytes = [IO.File]::ReadAllBytes($source)
      $stream.Write($bytes, 0, $bytes.Length)
    } finally { $stream.Dispose() }
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $file.sha256) {
      throw "Restored plugin file failed integrity verification."
    }
    Write-InstallerLog "Restored previous plugin entry: $($file.relativePath)" "WARN"
  }
  if ($conflicts.Count -gt 0) {
    throw "Existing plugin files changed and were left untouched ($($conflicts.Count)); other missing files were restored. Backup: $($Snapshot.backupRoot)"
  }
}

function Install-CodexPlugin {
  param([string]$CodexCommand, [string]$CacheRoot)

  $snapshot = Save-PluginCache -CacheRoot $CacheRoot
  try {
    $installExit = Invoke-Codex -CodexCommand $CodexCommand -Arguments @('plugin', 'add', 'findcheap-agent@findcheap-agent') -AllowFailure
  } finally {
    Restore-MissingPluginCacheFiles -Snapshot $snapshot
  }
  if ($installExit -ne 0) {
    throw "Codex plugin installation failed (exit $installExit). Previous files are preserved. Close Codex and rerun this installer. Backup: $($snapshot.backupRoot)"
  }
}

function Test-InstalledPlugin {
  param($Installed, [string]$CacheRoot)

  if ($Installed.pluginId -ne 'findcheap-agent@findcheap-agent' -or
      $Installed.installed -ne $true -or $Installed.enabled -ne $true) {
    throw 'Codex does not report FindCheap as installed and enabled.'
  }
  $version = [string]$Installed.version
  if ($version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+[A-Za-z0-9.+_-]*$') {
    throw 'Codex returned an invalid plugin version.'
  }
  $installedRoot = Get-CacheFilePath -Root $CacheRoot -RelativePath $version
  $manifestPath = Get-CacheFilePath -Root $installedRoot -RelativePath '.codex-plugin/plugin.json'
  $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
  if ($manifest.name -ne 'findcheap-agent' -or $manifest.version -cne $version) {
    throw 'Installed plugin manifest does not match Codex installed state.'
  }
  $sourceRoot = [string]$Installed.source.path
  if ([string]::IsNullOrWhiteSpace($sourceRoot) -or -not [IO.Path]::IsPathRooted($sourceRoot)) {
    throw 'Codex did not provide a local marketplace distribution for integrity verification.'
  }
  $sourceFiles = @(Get-PluginFiles -Root $sourceRoot)
  if ($sourceFiles.Count -eq 0) { throw 'Marketplace plugin distribution is missing.' }
  if (@(Get-PluginFiles -Root $installedRoot).Count -ne $sourceFiles.Count) {
    throw 'Installed plugin file inventory differs from the marketplace distribution.'
  }
  foreach ($relative in $sourceFiles) {
    $source = Get-CacheFilePath -Root $sourceRoot -RelativePath $relative
    $installedFile = Get-CacheFilePath -Root $installedRoot -RelativePath $relative
    if (-not (Test-Path -LiteralPath $installedFile -PathType Leaf)) {
      throw "Installed plugin file is missing: $relative"
    }
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne
        (Get-FileHash -LiteralPath $installedFile -Algorithm SHA256).Hash) {
      throw "Installed plugin file differs from the marketplace distribution: $relative"
    }
  }
  return $version
}

function Get-InstalledPluginVersion {
  param([string]$CodexCommand, [string]$CacheRoot)

  $result = & $CodexCommand plugin list --marketplace findcheap-agent --json
  if ($LASTEXITCODE -ne 0) { throw 'Unable to query Codex installed plugin state.' }
  $state = ($result -join "`n") | ConvertFrom-Json
  $installed = @($state.installed | Where-Object { $_.pluginId -eq 'findcheap-agent@findcheap-agent' })
  if ($installed.Count -ne 1) { throw 'Codex did not return one installed FindCheap plugin.' }
  return Test-InstalledPlugin -Installed $installed[0] -CacheRoot $CacheRoot
}

if ($DryRun) {
  Write-Host "FindCheap Agent installer dry run"
  Write-Host "Installer version: $InstallerVersion"
  Write-Host "Marketplace: $MarketplaceRepository"
  Write-Host "Plugin: $PluginReference"
  Write-Host "Planned actions: verify Codex, ensure Node.js 24, add or upgrade marketplace, install plugin, verify cache."
  exit 0
}

try {
  New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
  Set-Content -LiteralPath $LogPath -Value "FindCheap Agent installer $InstallerVersion" -Encoding utf8

  Write-InstallerLog "Starting FindCheap Agent installation."

  $nodeCommand = Get-Node24Command
  if ($null -eq $nodeCommand) {
    $nodeCommand = Install-PortableNode24
  } else {
    Write-InstallerLog "Using Node.js $((& $nodeCommand --version).Trim())." "OK"
  }

  $codexCommand = Find-CodexCommand
  if ([string]::IsNullOrWhiteSpace($codexCommand)) {
    throw "Codex was not found. Install or update Codex Desktop, then run this installer again."
  }
  Write-InstallerLog "Codex detected." "OK"

  $upgradeExit = Invoke-Codex -CodexCommand $codexCommand -Arguments @("plugin", "marketplace", "upgrade", $MarketplaceName) -AllowFailure
  if ($upgradeExit -ne 0) {
    Write-InstallerLog "Marketplace is not installed yet; adding it from GitHub."
    Invoke-Codex -CodexCommand $codexCommand -Arguments @("plugin", "marketplace", "add", $MarketplaceRepository, "--ref", "main") | Out-Null
  }

  $codexRoot = if ([string]::IsNullOrWhiteSpace($env:CODEX_HOME)) { Join-Path $env:USERPROFILE '.codex' } else { $env:CODEX_HOME }
  $cacheRoot = Join-Path $codexRoot 'plugins\cache\findcheap-agent\findcheap-agent'
  Install-CodexPlugin -CodexCommand $codexCommand -CacheRoot $cacheRoot

  $installedVersion = Get-InstalledPluginVersion -CodexCommand $codexCommand -CacheRoot $cacheRoot
  Write-InstallerLog "FindCheap Agent $installedVersion is installed, enabled, and matches its marketplace files." "OK"

  Write-InstallerLog "Restart Codex and open a new task before testing. The running app may still use its previous plugin path." "WARN"
  Write-Host "Log: $LogPath"
  exit 0
} catch {
  Write-InstallerLog $_.Exception.Message "ERROR"
  Write-Host "Log: $LogPath"
  exit 1
}
