param([string]$SdkRoot)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$destination=Join-Path $projectRoot 'vscode-extension/native-window'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
if(-not $SdkRoot){throw 'Specify the extracted official Microsoft.Web.WebView2 1.0.4258.31 SDK directory.'}
foreach($library in @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll')){
 Copy-Item -LiteralPath (Join-Path $SdkRoot "lib/net462/$library") -Destination $destination
}
Copy-Item -LiteralPath (Join-Path $SdkRoot 'runtimes/win-x64/native/WebView2Loader.dll') -Destination $destination
Copy-Item -LiteralPath (Join-Path $SdkRoot 'LICENSE.txt') -Destination (Join-Path $destination 'WebView2-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $SdkRoot 'NOTICE.txt') -Destination (Join-Path $destination 'WebView2-NOTICE.txt')
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ "/out:$destination/coach-window.exe" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "/reference:$destination/Microsoft.Web.WebView2.Core.dll" "/reference:$destination/Microsoft.Web.WebView2.WinForms.dll" (Join-Path $projectRoot 'native/floating-window.cs')
if($LASTEXITCODE -ne 0){throw 'Floating window build failed.'}
