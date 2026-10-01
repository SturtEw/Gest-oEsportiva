@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem ExecutionPolicy applies only to this child PowerShell process. No elevation or machine policy change.
rem The secret must already be supplied by a trusted parent; never accept it as an argument.
rem Never echo the raw argument: it is compared only against literal action words below.
set "ACTION=%~1"
if not defined ACTION set "ACTION=Check"
if /I "%ACTION%"=="Check" goto run
if /I "%ACTION%"=="Build" goto run
if /I "%ACTION%"=="Deploy" goto run
if /I "%ACTION%"=="Emulators" goto run
echo Use: firebase-windows.cmd [Check^|Build^|Deploy^|Emulators] 1>&2
exit /b 2
:run
if not "%~2"=="" (
  echo Only one action is allowed. 1>&2
  exit /b 2
)
rem Resolve PowerShell by absolute path: a constrained or trimmed PATH must not turn
rem this wrapper into a silent 9009. Falls back to PATH only if the fixed path is absent.
set "PSEXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PSEXE%" set "PSEXE=powershell.exe"
"%PSEXE%" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0firebase-windows.ps1" "%ACTION%"
exit /b %errorlevel%
