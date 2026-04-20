#Requires -Version 5
<#
.SYNOPSIS
    Installs CLI agent tools used by Hive if they are not already present.

.DESCRIPTION
    Checks for each supported CLI tool and installs any that are missing.
    Run this once before launching the app to ensure all agents are available.

    Supported tools:
      - gh            GitHub CLI (required for Copilot CLI)
      - gh copilot    GitHub Copilot extension for gh
      - claude        Anthropic Claude Code (npm global)

.NOTES
    Requires: winget (Windows 10/11 built-in), Node.js / npm
    Run as your normal user — winget does NOT need Administrator for user installs.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Step([string]$msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg)   { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Skip([string]$msg) { Write-Host "    [--] $msg" -ForegroundColor DarkGray }
function Write-Fail([string]$msg) { Write-Host "    [!!] $msg" -ForegroundColor Red }

# ── 1. GitHub CLI (gh) ─────────────────────────────────────────────────────

Write-Step "GitHub CLI (gh)"
$ghPath = Get-Command gh -ErrorAction SilentlyContinue
if ($ghPath) {
    $ghVer = (gh --version 2>&1 | Select-Object -First 1).ToString().Trim()
    Write-Skip "Already installed: $ghVer"
} else {
    Write-Host "    Installing via winget..." -ForegroundColor Yellow
    try {
        winget install --id GitHub.cli --accept-source-agreements --accept-package-agreements --silent
        # Refresh PATH so gh is immediately available in this session
        $env:PATH = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                    [System.Environment]::GetEnvironmentVariable('Path','User')
        Write-Ok "GitHub CLI installed."
    } catch {
        Write-Fail "winget install failed: $_"
        Write-Host "    Install manually: https://cli.github.com/" -ForegroundColor DarkYellow
    }
}

# ── 2. gh auth status ──────────────────────────────────────────────────────

Write-Step "GitHub CLI authentication"
$ghCmd = Get-Command gh -ErrorAction SilentlyContinue
if ($ghCmd) {
    $authStatus = gh auth status 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Skip "Already authenticated."
    } else {
        Write-Host "    Not authenticated. Launching browser login..." -ForegroundColor Yellow
        gh auth login --web --git-protocol https
    }
} else {
    Write-Skip "gh not available — skipping auth."
}

# ── 3. GitHub Copilot CLI extension ───────────────────────────────────────

Write-Step "GitHub Copilot CLI (gh extension)"
$ghCmd = Get-Command gh -ErrorAction SilentlyContinue
if ($ghCmd) {
    $extensions = gh extension list 2>&1
    if ($extensions -match 'copilot') {
        $copilotVer = ($extensions | Select-String 'copilot').Line.Trim()
        Write-Skip "Already installed: $copilotVer"
    } else {
        Write-Host "    Installing gh copilot extension..." -ForegroundColor Yellow
        try {
            gh extension install github/gh-copilot
            Write-Ok "gh copilot extension installed."
        } catch {
            Write-Fail "Extension install failed: $_"
        }
    }
} else {
    Write-Skip "gh not available — skipping Copilot CLI extension."
}

# ── 4. Claude Code (Anthropic) ────────────────────────────────────────────

Write-Step "Claude Code CLI (claude)"
$claudePath = Get-Command claude -ErrorAction SilentlyContinue
if ($claudePath) {
    $claudeVer = (claude --version 2>&1 | Select-Object -First 1).ToString().Trim()
    Write-Skip "Already installed: $claudeVer"
} else {
    $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
    if ($npmCmd) {
        Write-Host "    Installing @anthropic-ai/claude-code via npm..." -ForegroundColor Yellow
        try {
            npm install -g @anthropic-ai/claude-code
            Write-Ok "Claude Code installed."
        } catch {
            Write-Fail "npm install failed: $_"
            Write-Host "    Install manually: npm install -g @anthropic-ai/claude-code" -ForegroundColor DarkYellow
        }
    } else {
        Write-Skip "npm not found — install Node.js first, then run: npm install -g @anthropic-ai/claude-code"
    }
}

# ── Summary ────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "Done." -ForegroundColor Cyan
Write-Host "Restart Hive for the app to detect newly installed tools." -ForegroundColor DarkGray
Write-Host ""
