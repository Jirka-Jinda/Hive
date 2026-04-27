#Requires -Version 5
<#
.SYNOPSIS
    Installs all workspace dependencies and optional CLI agent tools.

.DESCRIPTION
    1. Runs `npm install` at the workspace root to install all npm packages
       across every workspace (backend, frontend, electron).
    2. Optionally runs the CLI-tools installer to ensure Copilot, Claude, and
       Codex are available for the backend agents.

.PARAMETER SkipCliTools
    Skip the CLI agent-tools installation step.
#>

param(
    [switch]$SkipCliTools
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent

function Write-Step([string]$msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg)   { Write-Host "    [OK] $msg" -ForegroundColor Green }

# ── 1. npm install ────────────────────────────────────────────────────────

Write-Step "Installing npm workspace dependencies"
Set-Location $root
npm install
Write-Ok "npm install complete."

# ── 2. CLI agent tools ────────────────────────────────────────────────────

if (-not $SkipCliTools) {
    Write-Step "Installing CLI agent tools (Copilot, Claude, Codex)"
    & "$root\scripts\install-cli-tools.ps1"
} else {
    Write-Host "`n    [--] Skipping CLI tool installation (-SkipCliTools)." -ForegroundColor DarkGray
}

Write-Host "`n==> Installation complete. Run install\dev.ps1 to start the dev environment." -ForegroundColor Green
