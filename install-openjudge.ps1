param([string]$NodePath,[string]$CodexPath,[string]$CompilerPath)
$ErrorActionPreference='Stop'
if(-not $NodePath){$NodePath=(Get-Command node -ErrorAction Stop).Source}
if(-not $CodexPath){$CodexPath=(Get-Command codex.exe -ErrorAction SilentlyContinue).Source}
if(-not $CodexPath -or [IO.Path]::GetExtension($CodexPath) -ne '.exe'){throw '请用 -CodexPath 指定已登录的 codex.exe 的绝对路径；不执行 PowerShell 或批处理包装脚本。'}
if(-not $CompilerPath){$CompilerPath=(Get-Command g++ -ErrorAction Stop).Source}
& $NodePath (Join-Path $PSScriptRoot 'native/prepare-openjudge.js') $NodePath $CodexPath $CompilerPath
if($LASTEXITCODE -ne 0){throw '准备独立 OpenJudge 配置失败。'}
& $CompilerPath '-std=c++17' '-O2' '-municode' '-static' (Join-Path $PSScriptRoot 'native/launcher.cpp') '-o' (Join-Path $PSScriptRoot 'native/launcher.exe')
if($LASTEXITCODE -ne 0){throw '构建独立连接程序失败。'}
$registryPath='HKCU:\Software\Google\Chrome\NativeMessagingHosts\edu.openjudge.cpp_coach'
$manifestPath=Join-Path $PSScriptRoot 'native/edu.openjudge.cpp_coach.json'
if(Test-Path -LiteralPath $registryPath){$previous=(Get-Item -LiteralPath $registryPath).GetValue('');if($previous -and $previous -ne $manifestPath){throw "已有独立 OpenJudge 安装：$previous；未覆盖。"}}
New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $manifestPath
Write-Host '独立 OpenJudge 连接已注册，原北大插件的注册信息和目录未修改。'
Write-Host '在 Chrome 加载以下独立扩展目录，然后在 OpenJudge 页点击它的工具栏图标：'
Write-Host (Join-Path $PSScriptRoot 'extension')
