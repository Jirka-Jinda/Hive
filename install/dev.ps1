#Requires -Version 5
<#
.SYNOPSIS
    Starts the full development environment (backend, frontend, Electron).

.DESCRIPTION
    Runs `npm run electron:dev` from the workspace root, which concurrently
    launches the backend dev server, the Vite frontend dev server, and the
    Electron main process (waiting for the frontend to be ready first).
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent

Write-Host "==> Starting dev environment..." -ForegroundColor Cyan
Set-Location $root
npm run electron:dev
