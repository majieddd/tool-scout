# check-git-staleness.ps1
#
# SessionStart hook for the Tool Scout repo.
#
# Detects when local main is behind origin/main and emits a clear warning so
# Claude (and the user) know to `git pull --ff-only origin main` before any
# build/commit. Critical because the daily-crawl + fast-poll GitHub workflows
# push commits to origin/main throughout the day; if Claude builds against
# stale local state the resulting site won't reflect today's catalog.
#
# Output: JSON on stdout. The Claude Code hook runner reads it and injects
# `systemMessage` (user-visible) + `hookSpecificOutput.additionalContext`
# (Claude-visible). On any error, exits silently with code 0 so a missing
# network / detached HEAD / weird repo state doesn't block session start.

$ErrorActionPreference = "SilentlyContinue"

try {
    # Only fire inside THIS repo — don't run on every Claude session globally.
    $repoRoot = git rev-parse --show-toplevel 2>$null
    if ([string]::IsNullOrEmpty($repoRoot)) { exit 0 }

    # git on Windows returns forward slashes. Normalize and compare.
    $expectedRoot = "C:/Users/Majied LaFleur/Documents/ClaudeWorkspace/ToolScout/tool-scout"
    $repoRootNormalized = $repoRoot.Replace('\', '/')
    if ($repoRootNormalized -ne $expectedRoot) { exit 0 }

    # Best-effort fetch with a hard timeout. If origin is unreachable
    # (offline, etc.), bail silently — the user can still work locally.
    $fetchJob = Start-Job -ScriptBlock { git -C $using:repoRoot fetch --quiet origin main 2>$null }
    $completed = Wait-Job -Job $fetchJob -Timeout 5
    Remove-Job -Job $fetchJob -Force 2>$null
    if (-not $completed) {
        # Fetch took longer than 5s — likely network issue. Skip silently.
        exit 0
    }

    # Count commits behind. If origin/main doesn't exist locally (e.g. brand
    # new clone), this returns empty and we exit silently.
    $behindStr = git rev-list --count HEAD..origin/main 2>$null
    if ([string]::IsNullOrEmpty($behindStr)) { exit 0 }

    $behind = 0
    if (-not [int]::TryParse($behindStr.Trim(), [ref]$behind)) { exit 0 }
    if ($behind -le 0) { exit 0 }

    # Build the JSON payload. Use here-string + manual escaping to avoid
    # ConvertTo-Json quoting quirks with backticks in messages.
    $userMsg = "Local main is $behind commit(s) behind origin/main. The crawler-bot pushes data updates throughout the day — run ``git pull --ff-only origin main`` before any web build or commit."

    $claudeCtx = @"
GIT STATE: local main is $behind commits behind origin/main.

The Tool Scout repo has TWO automated GitHub workflows that push data updates to origin/main throughout the day:
  - .github/workflows/fast-poll.yml (hourly @ :12 past every hour) — fast crawl of trending sources
  - .github/workflows/daily-crawl.yml (daily @ 03:00 UTC) — full crawl across all sources
Both update web/public/data/*.json (tools.json, meta.json, recommendations.json, grades_index.json).

Before running 'npm run build', creating a commit, or trusting any field of meta.json (especially live_tools count), run:
    git pull --ff-only origin main

If the user reports a count mismatch (e.g. "live_tools shows X but I expected Y"), the first thing to check is whether local is behind origin.
"@

    # Manual JSON construction with safe escaping for our specific strings
    # (no embedded quotes/newlines beyond what we control, so this is OK).
    $userMsgJson = $userMsg.Replace('\', '\\').Replace('"', '\"')
    $claudeCtxJson = $claudeCtx.Replace('\', '\\').Replace('"', '\"').Replace("`r`n", '\n').Replace("`n", '\n')

    $payload = '{"systemMessage":"' + $userMsgJson + '","hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"' + $claudeCtxJson + '"}}'
    Write-Output $payload
    exit 0
}
catch {
    # Any unexpected error: stay silent. A broken hook must never block work.
    exit 0
}
