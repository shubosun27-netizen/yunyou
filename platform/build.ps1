# 将 platform/parts/*.js 合并为 platform-main.js（供 layout-preview.html 引用）
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$partsDir = Join-Path $PSScriptRoot 'parts'
$outFile = Join-Path $root 'platform-main.js'

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('/**')
[void]$sb.AppendLine(' * Platform main logic (built from platform/parts — edit parts, then run build.ps1)')
[void]$sb.AppendLine(' */')
[void]$sb.AppendLine('(function () {')

Get-ChildItem -Path $partsDir -Filter '*.js' | Sort-Object Name | ForEach-Object {
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine("    /* --- $($_.Name) --- */")
    $content = Get-Content -Path $_.FullName -Raw -Encoding UTF8
    if ($content) {
        $lines = $content -split "`r?`n"
        foreach ($line in $lines) {
            if ($line.Length -eq 0) {
                [void]$sb.AppendLine('')
            } else {
                [void]$sb.AppendLine($line)
            }
        }
    }
}

[void]$sb.AppendLine('')
[void]$sb.AppendLine('})();')

[System.IO.File]::WriteAllText($outFile, $sb.ToString(), [System.Text.UTF8Encoding]::new($false))
Write-Host "Built $outFile"

# 1) 分片结构 + 合并语法（花括号平衡、孤立 }、onclick 导出）
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    & node (Join-Path $PSScriptRoot 'check-parts.js')
    if ($LASTEXITCODE -ne 0) {
        throw "platform/parts validation failed — fix parts before shipping"
    }
} else {
    Write-Warning "node not found; skip check-parts.js"
}

# 2) 构建产物语法（与浏览器解析一致）
if ($node) {
    & node --check $outFile
    if ($LASTEXITCODE -ne 0) {
        throw "platform-main.js syntax check failed"
    }
    Write-Host "Syntax OK: $outFile"
} else {
    Write-Warning "node not found; skip syntax check on platform-main.js"
}

# 3) 刷新 JS/CSS 缓存戳与 version.json
if ($node) {
    & node (Join-Path $root 'scripts/stamp-version.js')
    if ($LASTEXITCODE -ne 0) {
        throw "stamp-version.js failed"
    }
} else {
    Write-Warning "node not found; skip stamp-version.js"
}
