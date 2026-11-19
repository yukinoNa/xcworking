# 一键把工作台挂到公网，并显示可分享的地址
# 用法：右键 -> 使用 PowerShell 运行
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$cf = Join-Path (Split-Path -Parent $here) "tools\cloudflared.exe"

if (-not (Test-Path $cf)) {
  Write-Host "找不到 cloudflared：$cf" -ForegroundColor Red
  Read-Host "按回车退出"
  exit 1
}

Write-Host "启动工作台服务..." -ForegroundColor Cyan
$server = Start-Process node -ArgumentList "server.js" -WorkingDirectory $here -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 3

try {
  Invoke-WebRequest -Uri "http://localhost:5173/api/schedule" -UseBasicParsing -TimeoutSec 8 | Out-Null
  Write-Host "  服务已就绪" -ForegroundColor Green
} catch {
  Write-Host "  服务启动失败，检查是否已占用 5173 端口" -ForegroundColor Red
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  Read-Host "按回车退出"
  exit 1
}

Write-Host "建立公网隧道..." -ForegroundColor Cyan
$log = Join-Path $env:TEMP "pubhub-tunnel.log"
Remove-Item $log -Force -ErrorAction SilentlyContinue
$tunnel = Start-Process $cf -ArgumentList "tunnel","--url","http://localhost:5173","--no-autoupdate" -PassThru -WindowStyle Hidden -RedirectStandardError $log

$url = $null
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 600
  if (Test-Path $log) {
    $m = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value; break }
  }
}

if ($url) {
  try { Set-Clipboard -Value $url } catch { }
  Write-Host ""
  Write-Host "公开地址（已复制到剪贴板，直接粘贴给同事）：" -ForegroundColor Green
  Write-Host "  $url" -ForegroundColor Yellow
  Write-Host "  $url/admin.html   <- 后台，自己用" -ForegroundColor Gray
  Write-Host ""
  Write-Host "关闭方法：按 Ctrl+C 或直接关掉这个窗口" -ForegroundColor Gray
  Write-Host "注意：关掉后网站立即下线，且下次启动地址会变" -ForegroundColor DarkGray
} else {
  Write-Host "隧道建立失败，检查网络后重试" -ForegroundColor Red
}

try { Wait-Process -Id $tunnel.Id } finally {
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
}
