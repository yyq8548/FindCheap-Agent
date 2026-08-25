# FindCheap Agent Windows installer

`Install-FindCheap-Agent.cmd` is the user-facing one-click launcher. It downloads the current
PowerShell installer from this repository over HTTPS and then:

1. detects Codex Desktop or the Codex CLI;
2. installs an official portable Node.js 24 runtime when Node 24 is unavailable;
3. adds the runtime to the current user's `PATH`;
4. adds or upgrades the `findcheap-agent` marketplace from `main`;
5. installs the latest `findcheap-agent@findcheap-agent` plugin;
6. reports the installed cache version and writes a local log.

The installer does not request or store Awin, Shopify, merchant, payment, or account credentials.
Its state and log are stored under `%LOCALAPPDATA%\FindCheapAgent`.

## Test without changing the machine

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\installers\windows\Install-FindCheap-Agent.ps1 -DryRun
```

## PM instructions

Download `Install-FindCheap-Agent.cmd`, double-click it, wait for the success message, restart
Codex, and open a new task. Windows may show the normal confirmation for a downloaded script.
