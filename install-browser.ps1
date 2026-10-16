$ErrorActionPreference = 'Stop'
$nodeCommand = (Get-Command node -ErrorAction Stop).Source
$codexCommand = (Get-Command codex -ErrorAction Stop).Source
$cppCommand = (Get-Command g++ -ErrorAction Stop).Source
& $nodeCommand (Join-Path $PSScriptRoot 'native/prepare.js') $nodeCommand $codexCommand $cppCommand
if ($LASTEXITCODE -ne 0) { throw '准备本机连接配置失败。' }
& $cppCommand '-std=c++17' '-O2' '-municode' '-static' (Join-Path $PSScriptRoot 'native/launcher.cpp') '-o' (Join-Path $PSScriptRoot 'native/launcher.exe')
if ($LASTEXITCODE -ne 0) { throw '构建本机连接程序失败。' }
$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\edu.pku.cpp_coach'
$manifestPath = Join-Path $PSScriptRoot 'native/edu.pku.cpp_coach.json'
if (Test-Path $registryPath) {
    $previous = (Get-Item $registryPath).GetValue('')
    if ($previous -and $previous -ne $manifestPath) { throw "已有其他安装：$previous。未覆盖，请先核对。" }
}
New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $manifestPath
Write-Host '本机连接程序已注册。下一步在 Chrome 的 chrome://extensions 开启开发者模式，点击“加载已解压的扩展程序”，选择：'
Write-Host (Join-Path $PSScriptRoot 'extension')
Write-Host '刷新北大 IDE 页面，点击右下角“分析并保存”。'
