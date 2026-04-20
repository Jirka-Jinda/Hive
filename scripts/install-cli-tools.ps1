#Requires -Version 5
<#
.SYNOPSIS
    Installs CLI agent tools used by Hive if they are not already present.

.DESCRIPTION
    Checks for each supported CLI tool and installs any that are missing.
    Run this once before launching the app to ensure all agents are available.

    Supported tools:
      - copilot       GitHub Copilot CLI (winget: GitHub.Copilot)
      - claude        Anthropic Claude Code (npm global)
      - codex         OpenAI Codex CLI (npm global)

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

# ── 1. GitHub Copilot CLI ─────────────────────────────────────────────────

Write-Step "GitHub Copilot CLI (copilot)"
$copilotPath = Get-Command copilot -ErrorAction SilentlyContinue
if ($copilotPath) {
    $copilotVer = (copilot --version 2>&1 | Select-Object -First 1).ToString().Trim()
    Write-Skip "Already installed: $copilotVer"
} else {
    Write-Host "    Installing via winget (GitHub.Copilot)..." -ForegroundColor Yellow
    try {
        winget install --id GitHub.Copilot --accept-source-agreements --accept-package-agreements --silent
        # Refresh PATH so copilot is immediately available in this session
        $env:PATH = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                    [System.Environment]::GetEnvironmentVariable('Path','User')
        Write-Ok "GitHub Copilot CLI installed."
    } catch {
        Write-Fail "winget install failed: $_"
        Write-Host "    Install manually: winget install --id GitHub.Copilot" -ForegroundColor DarkYellow
    }
}

# ── 2. Claude Code (Anthropic) ────────────────────────────────────────────

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

# ── 3. Codex CLI (OpenAI) ─────────────────────────────────────────────────

Write-Step "Codex CLI (@openai/codex)"
$codexPath = Get-Command codex -ErrorAction SilentlyContinue
if ($codexPath) {
    $codexVer = (codex --version 2>&1 | Select-Object -First 1).ToString().Trim()
    Write-Skip "Already installed: $codexVer"
} else {
    $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
    if ($npmCmd) {
        Write-Host "    Installing @openai/codex via npm..." -ForegroundColor Yellow
        try {
            npm install -g @openai/codex
            Write-Ok "Codex CLI installed."
        } catch {
            Write-Fail "npm install failed: $_"
            Write-Host "    Install manually: npm install -g @openai/codex" -ForegroundColor DarkYellow
        }
    } else {
        Write-Skip "npm not found — install Node.js first, then run: npm install -g @openai/codex"
    }
}

# ── 4. Codex authentication check ─────────────────────────────────────────

Write-Step "Codex CLI authentication"
$codexCmd = Get-Command codex -ErrorAction SilentlyContinue
if ($codexCmd) {
    $codexStatus = codex login status 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Skip "Already authenticated."
    } else {
        Write-Host "    Not authenticated." -ForegroundColor Yellow
        Write-Host "    To authenticate with an API key, run:" -ForegroundColor DarkYellow
        Write-Host "        codex login --with-api-key" -ForegroundColor DarkYellow
        Write-Host "    Or add OPENAI_API_KEY to credentials in the Hive app." -ForegroundColor DarkYellow
    }
} else {
    Write-Skip "codex not available — skipping auth check."
}

# ── Summary ────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "Done." -ForegroundColor Cyan
Write-Host "Restart Hive for the app to detect newly installed tools." -ForegroundColor DarkGray
Write-Host ""
