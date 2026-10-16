$ErrorActionPreference = 'Stop'
$encodedPath = Join-Path $PSScriptRoot 'naiwa-pet-assets.zip.b64'
$outputPath = Join-Path $PSScriptRoot 'naiwa-pet-assets.zip'
$encoded = Get-Content -LiteralPath $encodedPath -Raw
$bytes = [Convert]::FromBase64String($encoded)
[IO.File]::WriteAllBytes($outputPath, $bytes)
Write-Output "Created $outputPath ($($bytes.Length) bytes)"
