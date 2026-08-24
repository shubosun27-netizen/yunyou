# Git pre-commit（Windows / PowerShell）
# 启用: git config core.hooksPath .githooks

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$changed = git diff --cached --name-only
if (-not $changed) { exit 0 }

$needsBuild = $false
$needsStamp = $false

foreach ($line in $changed) {
    if ($line -match '^platform/parts/' -or $line -match '^platform/build\.ps1$' -or $line -match '^platform/check-') {
        $needsBuild = $true
    }
    if ($line -match '^(tasks|activity-runtime|farm-tactics|pk-runtime|task-handlers|task-handlers-wolong)\.js$') {
        $needsStamp = $true
    }
    if ($line -match '^layout-preview\.(html|css)$' -or $line -match '^game\.html$') {
        $needsStamp = $true
    }
    if ($line -match '^scripts/stamp-version\.js$' -or $line -match '^version\.json$') {
        $needsStamp = $true
    }
}

if (-not $needsBuild -and -not $needsStamp) { exit 0 }

if ($needsBuild) {
    Write-Host '[pre-commit] platform parts changed — running validate...'
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        npm run validate
    } else {
        powershell -NoProfile -ExecutionPolicy Bypass -File platform/build.ps1
        node platform/check-all.js
    }
    git add platform-main.js 2>$null
} elseif ($needsStamp) {
    Write-Host '[pre-commit] assets changed — refreshing version stamp...'
    node scripts/stamp-version.js
}

git add version.json layout-preview.html game.html 2>$null
Write-Host '[pre-commit] OK'
