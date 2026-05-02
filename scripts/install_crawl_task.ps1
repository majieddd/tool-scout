# =============================================================================
# install_crawl_task.ps1 — registers the daily crawl with Windows Task Scheduler
# =============================================================================
# Run once after `pip install -e .`.
# Equivalent of `scout schedule install crawl`.
# Re-running is safe — old task is replaced.
# =============================================================================

#Requires -Version 7.0

$ErrorActionPreference = "Stop"

$taskName = "ToolScoutDailyCrawl"

# Remove existing task if present
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Write-Host "Removing existing task: $taskName"
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$action = New-ScheduledTaskAction `
    -Execute "pwsh.exe" `
    -Argument "-NoProfile -Command `"scout crawl`""

$trigger = New-ScheduledTaskTrigger -Daily -At 3am

$settings = New-ScheduledTaskSettingsSet `
    -WakeToRun `
    -StartWhenAvailable `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 30) `
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
    -Description "Tool Scout: daily crawl at 03:00 for new Claude-compatible tools"

Write-Host "✓ Task registered: $taskName" -ForegroundColor Green
Write-Host "  Next run: $(($task = Get-ScheduledTask -TaskName $taskName | Get-ScheduledTaskInfo).NextRunTime)"
