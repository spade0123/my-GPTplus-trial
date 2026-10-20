$ErrorActionPreference = 'Stop'
$nodeCommand = (Get-Command node -ErrorAction Stop).Source
$codexCommand = (Get-Command codex -ErrorAction Stop).Source
$cppCommand = (Get-Command g++ -ErrorAction Stop).Source
$serverFile = Join-Path $PSScriptRoot 'src/server.js'
New-Item -Path (Join-Path $PSScriptRoot 'submissions') -ItemType Directory -Force | Out-Null
if (-not (Test-Path (Join-Path $PSScriptRoot 'node_modules/@modelcontextprotocol/sdk'))) {
    throw '请先在本目录执行 npm ci --ignore-scripts 安装依赖。'
}
& $codexCommand mcp get openjudge-cpp-coach --json 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { throw '已存在 openjudge-cpp-coach。请检查原配置，确认需要替换后手动移除同名条目再运行。' }
& $codexCommand mcp add openjudge-cpp-coach --env "PKU_CXX=$cppCommand" --env "PKU_CODE_ROOT=$(Join-Path $PSScriptRoot 'submissions')" -- $nodeCommand $serverFile
if ($LASTEXITCODE -ne 0) { throw '注册失败，请查看上面的错误信息。' }
Write-Host '已注册。请在新聊天中使用 openjudge-cpp-coach；若未显示，请重启 Codex。'
