[CmdletBinding()]
param(
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$InstallerVersion = "1.0.0"
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

function Get-Node22Command {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($null -eq $command) {
    return $null
  }

  try {
    $version = (& $command.Source --version 2>$null).Trim()
    if ($version -match '^v22\.') {
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

function Install-PortableNode22 {
  Write-InstallerLog "Node.js 22 was not found. Installing the official portable runtime."

  $checksumsUri = "https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt"
  $checksums = (Invoke-WebRequest -UseBasicParsing -Uri $checksumsUri).Content
  $archiveCandidate = $checksums -split "`n" |
    Where-Object { $_ -match 'node-v22\.[0-9]+\.[0-9]+-win-x64\.zip$' } |
    Select-Object -First 1
  if ([string]::IsNullOrWhiteSpace($archiveCandidate)) {
    throw "Unable to resolve the current Node.js 22 Windows archive."
  }
  $archiveLine = $archiveCandidate.Trim()
  if ($archiveLine -notmatch '^([a-fA-F0-9]{64})\s+(node-v22\.[0-9]+\.[0-9]+-win-x64\.zip)$') {
    throw "Unable to resolve the current Node.js 22 Windows archive."
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
    $archiveUri = "https://nodejs.org/dist/latest-v22.x/$archiveName"
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

function Get-InstalledPluginVersion {
  $codexRoot = if ([string]::IsNullOrWhiteSpace($env:CODEX_HOME)) {
    Join-Path $env:USERPROFILE ".codex"
  } else {
    $env:CODEX_HOME
  }
  $cacheRoot = Join-Path $codexRoot "plugins\cache\findcheap-agent\findcheap-agent"
  if (-not (Test-Path -LiteralPath $cacheRoot)) {
    return $null
  }

  $manifest = Get-ChildItem -LiteralPath $cacheRoot -Recurse -Filter plugin.json -File |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
  if ($null -eq $manifest) {
    return $null
  }

  try {
    return (Get-Content -Raw -LiteralPath $manifest.FullName | ConvertFrom-Json).version
  } catch {
    return $null
  }
}

if ($DryRun) {
  Write-Host "FindCheap Agent installer dry run"
  Write-Host "Installer version: $InstallerVersion"
  Write-Host "Marketplace: $MarketplaceRepository"
  Write-Host "Plugin: $PluginReference"
  Write-Host "Planned actions: verify Codex, ensure Node.js 22, add or upgrade marketplace, install plugin, verify cache."
  exit 0
}

try {
  New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
  Set-Content -LiteralPath $LogPath -Value "FindCheap Agent installer $InstallerVersion" -Encoding utf8

  Write-InstallerLog "Starting FindCheap Agent installation."

  $nodeCommand = Get-Node22Command
  if ($null -eq $nodeCommand) {
    $nodeCommand = Install-PortableNode22
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

  Invoke-Codex -CodexCommand $codexCommand -Arguments @("plugin", "add", $PluginReference) | Out-Null

  $installedVersion = Get-InstalledPluginVersion
  if ([string]::IsNullOrWhiteSpace($installedVersion)) {
    Write-InstallerLog "Plugin command succeeded, but the installed version could not be read. Restart Codex and check Plugins." "WARN"
  } else {
    Write-InstallerLog "FindCheap Agent $installedVersion is installed." "OK"
  }

  Write-InstallerLog "Restart Codex and open a new task before testing." "OK"
  Write-Host "Log: $LogPath"
  exit 0
} catch {
  Write-InstallerLog $_.Exception.Message "ERROR"
  Write-Host "Log: $LogPath"
  exit 1
}
