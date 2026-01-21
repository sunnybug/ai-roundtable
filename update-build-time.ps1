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

# 获取当前时间
$currentTime = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

if (-not (Test-Path $buildInfoPath)) {
    Write-Host "build-info.json 文件不存在，正在自动生成..." -ForegroundColor Yellow
    # 创建新的 JSON 对象
    $buildInfo = @{
        build_time = $currentTime
    }
} else {
    # 读取并解析 JSON
    $buildInfo = Get-Content $buildInfoPath -Raw -Encoding UTF8 | ConvertFrom-Json
    # 更新 build_time
    $buildInfo.build_time = $currentTime
}

# 保存文件
$buildInfo | ConvertTo-Json -Compress | Set-Content $buildInfoPath -Encoding UTF8 -NoNewline

Write-Host "已更新 build_time 为: $currentTime" -ForegroundColor Green
Write-Host "build-info.json 已更新" -ForegroundColor Green
