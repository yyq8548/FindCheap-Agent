# FindCheap Agent Windows installer

`Install-FindCheap-Agent.cmd` is the user-facing one-click launcher. It downloads the current
PowerShell installer from this repository over HTTPS and then:

1. detects Codex Desktop or the Codex CLI;
2. installs an official portable Node.js 24 runtime when Node 24 is unavailable;
3. adds the runtime to the current user's `PATH`;
4. backs up the existing FindCheap cache before any marketplace or plugin change;
5. adds or upgrades the `findcheap-agent` marketplace from `main`, then installs `findcheap-agent@findcheap-agent` if the marketplace update has not already installed and enabled an exact copy of its current distribution;
6. restores any missing previous files so a running Codex task retains its entry point;
7. checks the exact installed/enabled version reported by Codex and compares its files with the marketplace distribution.

The installer does not request or store Awin, Shopify, merchant, payment, or account credentials.
Its state and log are stored under `%LOCALAPPDATA%\FindCheapAgent`.
Exact recovery copies remain in its `cache-backups` directory. A plugin installation failure or a marketplace error that its add fallback cannot resolve remains a failed installation after cache recovery; close Codex and rerun the installer. Changed files are left untouched and reported as conflicts. Version directories are not used to infer which runtime the running app has loaded.

Installer 1.2.1 protects marketplace upgrade, fallback marketplace add, and plugin add with the same original snapshot. A verified marketplace installation skips redundant plugin add only after the installed/enabled state, manifest, full file inventory and every file hash match. Verification failure is logged and the normal plugin installation still runs. If installation and recovery both fail, the error reports both failures.

## Test without changing the machine

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\installers\windows\Install-FindCheap-Agent.ps1 -DryRun
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\installers\windows\Test-Installer.ps1
```

## PM instructions

Download `Install-FindCheap-Agent.cmd`, double-click it, wait for the success message, restart
Codex, and open a new task. Windows may show the normal confirmation for a downloaded script.
