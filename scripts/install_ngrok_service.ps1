# =============================================================================
# install_ngrok_service.ps1 — installs ngrok as a Windows Service
# =============================================================================
# One-time setup: reads NGROK_AUTHTOKEN and NGROK_STATIC_DOMAIN from .env,
# writes ngrok.yml, and registers ngrok as a Windows Service that auto-starts.
# =============================================================================

#Requires -Version 7.0

$ErrorActionPreference = "Stop"

# Load .env
$envPath = Join-Path $PSScriptRoot "..\.env"
if (-not (Test-Path $envPath)) {
    Write-Error ".env not found at $envPath. Run scout doctor first."
    exit 1
}

$envVars = @{}
Get-Content $envPath | ForEach-Object {
    if ($_ -match "^([A-Z_]+)=(.*)$") {
        $envVars[$matches[1]] = $matches[2].Trim()
    }
}

$authtoken = $envVars["NGROK_AUTHTOKEN"]
$domain = $envVars["NGROK_STATIC_DOMAIN"]
$port = if ($envVars["WEBHOOK_LOCAL_PORT"]) { $envVars["WEBHOOK_LOCAL_PORT"] } else { "8765" }

if (-not $authtoken -or -not $domain) {
    Write-Error "NGROK_AUTHTOKEN or NGROK_STATIC_DOMAIN missing from .env"
    exit 1
}

# Configure ngrok
Write-Host "Configuring ngrok authtoken..."
ngrok config add-authtoken $authtoken | Out-Null

# Write ngrok.yml
$ngrokDir = Join-Path $env:USERPROFILE ".ngrok2"
if (-not (Test-Path $ngrokDir)) {
    New-Item -ItemType Directory -Path $ngrokDir | Out-Null
}

$ngrokConfig = @"
version: "3"
agent:
  authtoken: $authtoken
tunnels:
  queue:
    proto: http
    addr: $port
    domain: $domain
"@

$ngrokConfig | Set-Content -Path "$ngrokDir\ngrok.yml" -Encoding UTF8
Write-Host "✓ Wrote $ngrokDir\ngrok.yml"

# Stop and remove existing service if any
$existing = Get-Service -Name "ngrok" -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Removing existing ngrok service..."
    if ($existing.Status -eq "Running") {
        ngrok service stop 2>$null
    }
    ngrok service uninstall 2>$null
    Start-Sleep -Seconds 2
}

# Install fresh
Write-Host "Installing ngrok as Windows Service..."
ngrok service install --config "$ngrokDir\ngrok.yml"
ngrok service start

Start-Sleep -Seconds 3
$svc = Get-Service -Name "ngrok" -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Write-Host "✓ ngrok service running" -ForegroundColor Green
    Write-Host "  Tunnel URL: https://$domain -> http://localhost:$port"
} else {
    Write-Error "ngrok service did not start cleanly. Check Get-Service ngrok."
    exit 1
}
