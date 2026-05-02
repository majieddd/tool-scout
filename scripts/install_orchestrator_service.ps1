# =============================================================================
# install_orchestrator_service.ps1 — Symphony orchestrator as Windows Service
# =============================================================================
# Wraps `scout orchestrator start` as a service via NSSM. Auto-starts on boot.
# Auto-restarts on crash. Logs to ~/.tool-scout/logs/orchestrator-{stdout,stderr}.log.
# =============================================================================

#Requires -Version 7.0

$ErrorActionPreference = "Stop"

$serviceName = "ToolScoutOrchestrator"
$displayName = "Tool Scout Symphony Orchestrator"
$description = "Long-running orchestrator for wrapper-generation queue. Polls SQLite, dispatches Claude Code workers in isolated workspaces, runs Docker smoke tests, publishes to GitHub."

# Verify NSSM is available
try {
    nssm version | Out-Null
} catch {
    Write-Error "NSSM not found. Install with: winget install NSSM.NSSM"
    exit 1
}

# Verify pwsh + scout are reachable
$pwshPath = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $pwshPath) {
    Write-Error "pwsh not found on PATH. Install PowerShell 7."
    exit 1
}

try {
    scout --version | Out-Null
} catch {
    Write-Error "scout CLI not on PATH. Run `pip install -e .` first."
    exit 1
}

# Stop and remove existing service if any
$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Removing existing service: $serviceName"
    if ($existing.Status -eq "Running") {
        nssm stop $serviceName | Out-Null
        Start-Sleep -Seconds 3
    }
    nssm remove $serviceName confirm | Out-Null
    Start-Sleep -Seconds 2
}

# Ensure log directory
$logDir = Join-Path $env:USERPROFILE ".tool-scout\logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

# Install fresh
Write-Host "Installing $serviceName via NSSM..."

nssm install $serviceName $pwshPath "-NoProfile -Command `"scout orchestrator start`""
nssm set $serviceName DisplayName $displayName
nssm set $serviceName Description $description
nssm set $serviceName AppDirectory $env:USERPROFILE
nssm set $serviceName AppStdout "$logDir\orchestrator-stdout.log"
nssm set $serviceName AppStderr "$logDir\orchestrator-stderr.log"
nssm set $serviceName AppRotateFiles 1
nssm set $serviceName AppRotateBytes 10485760    # 10 MB
nssm set $serviceName AppRotateOnline 1
nssm set $serviceName Start SERVICE_AUTO_START
nssm set $serviceName AppExit Default Restart
nssm set $serviceName AppRestartDelay 5000       # 5s before restart on crash
nssm set $serviceName AppKillProcessTree 1       # clean up child processes on stop

# Inherit the current user's environment so .env, claude CLI auth, Docker, etc. all work
nssm set $serviceName AppEnvironmentExtra "USERPROFILE=$env:USERPROFILE" "PATH=$env:PATH"

# Start it
Start-Service $serviceName
Start-Sleep -Seconds 3

$svc = Get-Service -Name $serviceName
if ($svc.Status -eq "Running") {
    Write-Host "✓ Service running: $serviceName" -ForegroundColor Green
    Write-Host "  Tail logs: Get-Content '$logDir\orchestrator-stdout.log' -Wait"
    Write-Host "  Live dashboard: scout queue dashboard"
} else {
    Write-Error "Service installed but did not reach Running state. Check $logDir\orchestrator-stderr.log"
    exit 1
}
