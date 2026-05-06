#Requires -Version 5
<#
.SYNOPSIS
    Builds and packages the Electron app for release (installer / distributable).

.DESCRIPTION
    Runs `npm run electron:dist` from the workspace root, which:
      1. Builds the frontend (Vite)
      2. Builds the backend
      3. Compiles the Electron main process (TypeScript)
      4. Clears previous release output so stale artifacts do not remain.
      5. Packages the Electron release artifacts via electron-builder.
      6. Organizes the output into `install/release/executable` and `install/release/installation`.
      7. Copies the repo README into both output folders.

    The finished release artifacts are placed under install/release.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent

Write-Host "==> Building release package..." -ForegroundColor Cyan
Set-Location $root
npm run electron:dist

Write-Host "`n==> Release build complete." -ForegroundColor Green
Write-Host "    Executable artifacts: install/release/executable" -ForegroundColor Green
Write-Host "    Installation artifacts: install/release/installation" -ForegroundColor Green
