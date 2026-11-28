# fighting-plus 开发进程管理脚本
# 用法：
#   powershell -File tooling/restart.ps1 -Target server          # 重启服务端 (NestJS, http://localhost:3118)
#   powershell -File tooling/restart.ps1 -Target web             # 重启 Web 端 (Vite, http://localhost:5173)
#   powershell -File tooling/restart.ps1 -Target client          # 重启桌面客户端 (Electron)
#   powershell -File tooling/restart.ps1 -Target server,web       # 同时重启
#   powershell -File tooling/restart.ps1 -Target all -Stop       # 仅停止
param(
  [string]$Target = 'server',
  [switch]$Stop
)

$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$targets = if ($Target -eq 'all') { @('server', 'web', 'client') } else { $Target.Split(',') | ForEach-Object { $_.Trim() } }

function Get-ProjectProcesses([string]$Pattern) {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and $_.CommandLine -match $Pattern -and $_.Name -match '^(node|electron|cmd)\.exe$'
  }
}

function Stop-ProcessTree([int]$Id) {
  Get-CimInstance Win32_Process -Filter "ParentProcessId=$Id" -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-ProcessTree $_.ProcessId
  }
  Stop-Process -Id $Id -Force -ErrorAction SilentlyContinue
}

function Stop-ByPort([int]$Port) {
  $conns = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  foreach ($c in ($conns | Sort-Object OwningProcess -Unique)) { Stop-ProcessTree $c.OwningProcess }
}

# 结束所有匹配进程，并等待它们完全退出（释放日志文件句柄），避免新进程启动失败
function Stop-And-Wait([string]$Pattern, [int]$Port) {
  Stop-ByPort $Port
  for ($i = 0; $i -lt 20; $i++) {
    $procs = @(Get-ProjectProcesses $Pattern)
    if ($procs.Count -eq 0 -and $i -gt 0) { return }
    foreach ($p in $procs) { Stop-ProcessTree $p.ProcessId }
    Start-Sleep -Milliseconds 400
  }
}

function Start-Dev([string]$Dir, [string]$Script, [string]$Log) {
  $wd = Join-Path $root $Dir
  $log = Join-Path $root $Log
  # 服务端默认端口由 apps/server/src/main.ts 决定，清除外部 shell 的 PORT 干扰
  if (Test-Path Env:PORT) { Remove-Item Env:PORT }
  Start-Process -FilePath 'cmd.exe' -ArgumentList "/c chcp 65001 >nul && npm run $Script > `"$log`" 2>&1" -WorkingDirectory $wd -WindowStyle Hidden | Out-Null
  Write-Host "已启动 $Dir (npm run $Script)，日志: $Log"
}

foreach ($t in $targets) {
  switch ($t) {
    'server' {
      Stop-And-Wait 'apps[\\/]server[\\/]' 3118
      if (-not $Stop) { Start-Dev 'apps\server' 'dev' 'apps\server\nest.log' }
    }
    'web' {
      Stop-And-Wait 'apps[\\/]frontend[\\/]' 5173
      if (-not $Stop) { Start-Dev 'apps\frontend' 'dev' 'apps\frontend\vite.log' }
    }
    'client' {
      Stop-And-Wait 'apps[\\/]client[\\/]' 0
      if (-not $Stop) { Start-Dev 'apps\client' 'dev' 'apps\client\electron.log' }
    }
  }
}
