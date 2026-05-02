# =============================================================================
# install_backup_task.ps1 — registers the daily DB backup task
# =============================================================================

#Requires -Version 7.0

$ErrorActionPreference = "Stop"

$taskName = "ToolScoutDailyBackup"

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Write-Host "Removing existing task: $taskName"
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$action = New-ScheduledTaskAction `
    -Execute "pwsh.exe" `
    -Argument "-NoProfile -Command `"scout backup`""

$trigger = New-ScheduledTaskTrigger -Daily -At 4:30am

$settings = New-ScheduledTaskSettingsSet `
    -WakeToRun `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries

$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType S4U `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Tool Scout: daily SQLite backup at 04:30 (after crawl finishes)"

Write-Host "✓ Task registered: $taskName" -ForegroundColor Green
