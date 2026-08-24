# Git pre-commit（Windows / PowerShell）
# 启用: git config core.hooksPath .githooks
#       并确保 Git 能执行 pre-commit.ps1，或复制为 pre-commit 无扩展名

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$changed = git diff --cached --name-only
if (-not $changed) { exit 0 }

$needs = $false
foreach ($line in $changed) {
    if ($line -match '^platform/parts/' -or $line -match '^platform/build\.ps1$' -or $line -match '^platform/check-') {
        $needs = $true
        break
    }
}
if (-not $needs) { exit 0 }

Write-Host '[pre-commit] platform parts changed — running validate...'
if (Get-Command npm -ErrorAction SilentlyContinue) {
    npm run validate
} else {
    powershell -NoProfile -ExecutionPolicy Bypass -File platform/build.ps1
    node platform/check-all.js
}

git add platform-main.js 2>$null
Write-Host '[pre-commit] OK'
