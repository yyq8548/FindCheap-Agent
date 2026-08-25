@echo off
setlocal
chcp 65001 >nul
title FindCheap Agent Installer

set "INSTALLER_URL=https://raw.githubusercontent.com/yyq8548/FindCheap-Agent/main/installers/windows/Install-FindCheap-Agent.ps1"
set "INSTALLER_FILE=%TEMP%\FindCheap-Agent-Installer-%RANDOM%-%RANDOM%.ps1"
set "CLEANUP_INSTALLER=1"
set "INSTALLER_ARGS="
set "NO_PAUSE=0"
if /I "%~1"=="--dry-run" (
  set "INSTALLER_ARGS=-DryRun"
  set "NO_PAUSE=1"
)

echo.
echo  FindCheap Agent - Latest Version Installer
echo  =========================================
echo.
if exist "%~dp0Install-FindCheap-Agent.ps1" (
  set "INSTALLER_FILE=%~dp0Install-FindCheap-Agent.ps1"
  set "CLEANUP_INSTALLER=0"
  echo  Using the installer packaged with this download...
) else (
  echo  Downloading the current installer from the official repository...
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri '%INSTALLER_URL%' -OutFile '%INSTALLER_FILE%'"
  if errorlevel 1 goto :download_failed
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%INSTALLER_FILE%" %INSTALLER_ARGS%
set "INSTALL_EXIT=%ERRORLEVEL%"
if "%CLEANUP_INSTALLER%"=="1" del /q "%INSTALLER_FILE%" >nul 2>&1

echo.
if not "%INSTALL_EXIT%"=="0" goto :install_failed
echo  Installation complete. Restart Codex and open a new task.
echo.
if "%NO_PAUSE%"=="1" exit /b 0
pause
exit /b 0

:download_failed
echo.
echo  Download failed. Check your internet connection and try again.
echo.
if "%NO_PAUSE%"=="1" exit /b 1
pause
exit /b 1

:install_failed
echo  Installation failed. The installer log path is shown above.
echo.
if "%NO_PAUSE%"=="1" exit /b %INSTALL_EXIT%
pause
exit /b %INSTALL_EXIT%
