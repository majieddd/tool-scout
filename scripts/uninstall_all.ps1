# =============================================================================
# uninstall_all.ps1 — removes Tool Scout's scheduled tasks and Windows Services
# =============================================================================
# Does NOT delete:
#   - The repository
#   - ~/.tool-scout/ (DB, logs, backups, workspaces)
#   - Cloud accounts (Vercel, ngrok, Google, GitHub)
#
# To wipe everything: run this script, then manually:
#   Remove-Item -Recurse -Force ~/.tool-scout
#   Remove-Item -Recurse -Force <repo path>
# =============================================================================

#Requires -Version 7.0

$ErrorActionPreference = "Continue"
Write-Host "Uninstalling Tool Scout system components..." -ForegroundColor Yellow

# Scheduled tasks
$tasks = @("ToolScoutDailyCrawl", "ToolScoutDailyBackup")
foreach ($t in $tasks) {
    if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
        Write-Host "  Removing task: $t"
        Unregister-ScheduledTask -TaskName $t -Confirm:$false
    }
}

# Windows Services (NSSM-managed orchestrator)
$nssmServices = @("ToolScoutOrchestrator")
foreach ($s in $nssmServices) {
    if (Get-Service -Name $s -ErrorAction SilentlyContinue) {
        Write-Host "  Stopping and removing service: $s"
        try { nssm stop $s 2>&1 | Out-Null } catch {}
        Start-Sleep -Seconds 2
        try { nssm remove $s confirm 2>&1 | Out-Null } catch {}
    }
}

# ngrok Windows Service
if (Get-Service -Name "ngrok" -ErrorAction SilentlyContinue) {
    Write-Host "  Stopping and removing ngrok service"
    try { ngrok service stop 2>&1 | Out-Null } catch {}
    Start-Sleep -Seconds 2
    try { ngrok service uninstall 2>&1 | Out-Null } catch {}
}

Write-Host ""
Write-Host "✓ Uninstall complete." -ForegroundColor Green
Write-Host ""
Write-Host "To wipe local data, run:"
Write-Host "  Remove-Item -Recurse -Force `$HOME\.tool-scout"
Write-Host ""
Write-Host "Cloud accounts (Vercel, ngrok, Google, GitHub repo) are untouched."
