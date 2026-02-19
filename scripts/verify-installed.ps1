$ErrorActionPreference = "Stop"

$extensionRoot = Join-Path $env:USERPROFILE ".vscode\extensions"
$installed = Get-ChildItem -Path $extensionRoot -Directory |
  Where-Object { $_.Name -like "*claude-code-mirror*" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $installed) {
  throw "ClaUi extension was not found under $extensionRoot"
}

$packageJsonPath = Join-Path $installed.FullName "package.json"
$bundlePath = Join-Path $installed.FullName "dist\extension.js"

if (-not (Test-Path $packageJsonPath)) {
  throw "Installed package.json not found: $packageJsonPath"
}

if (-not (Test-Path $bundlePath)) {
  throw "Installed runtime bundle not found: $bundlePath"
}

$packageText = Get-Content -Path $packageJsonPath -Raw
$requiredManifestEntries = @(
  "claudeMirror.sendFilePathToChat",
  "ctrl+alt+shift+c",
  "explorer/context",
  "editor/context"
)

foreach ($entry in $requiredManifestEntries) {
  if ($packageText -notmatch [regex]::Escape($entry)) {
    throw "Installed manifest is missing expected entry: $entry"
  }
}

if (-not (Select-String -Path $bundlePath -Pattern "sendFilePathToChat" -Quiet)) {
  throw "Installed extension.js does not contain sendFilePathToChat symbol"
}

Write-Host "Installed extension verified:"
Write-Host "  Path: $($installed.FullName)"
Write-Host "  LastWriteTime: $($installed.LastWriteTime)"
Write-Host "  Manifest + runtime checks: OK"
