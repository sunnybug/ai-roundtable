# 功能说明：更新 build-info.json 中的 build_time 字段为当前时间

$ErrorActionPreference = "Stop"
trap {
    Write-Host "命令行被中止: $_" -ForegroundColor Red
    Write-Host "$($_.InvocationInfo.ScriptName):$($_.InvocationInfo.ScriptLineNumber)" -ForegroundColor Red
    Write-Host "$($_.InvocationInfo.Line.Trim())" -ForegroundColor Red
    Read-Host "按 Enter 键关闭窗口"
    break
}

$buildInfoPath = Join-Path $PSScriptRoot "build-info.json"

if (-not (Test-Path $buildInfoPath)) {
    Write-Host "错误: 找不到 build-info.json 文件" -ForegroundColor Red
    exit 1
}

# 获取当前时间
$currentTime = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

# 读取并解析 JSON
$buildInfo = Get-Content $buildInfoPath -Raw -Encoding UTF8 | ConvertFrom-Json

# 更新 build_time
$buildInfo.build_time = $currentTime

# 保存文件
$buildInfo | ConvertTo-Json -Compress | Set-Content $buildInfoPath -Encoding UTF8 -NoNewline

Write-Host "已更新 build_time 为: $currentTime" -ForegroundColor Green
Write-Host "build-info.json 已更新" -ForegroundColor Green
