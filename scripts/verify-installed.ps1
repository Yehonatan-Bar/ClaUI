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
  "claudeMirror.carryCodexToClaudeCode",
  "ctrl+alt+shift+c",
  "explorer/context",
  "editor/context",
  # Tab folders + Sessions TreeView (Phase A)
  "claudeMirror.sessionsTree",
  "claudeMirror.groups.create",
  "claudeMirror.groups.createSubfolder",
  "claudeMirror.groups.rename",
  "claudeMirror.groups.changeColor",
  "claudeMirror.groups.delete",
  "claudeMirror.tabs.moveToGroup",
  "claudeMirror.tabs.removeFromGroup",
  "claudeMirror.tabs.focus",
  "view/item/context",
  # End-of-session summary (Phase B)
  "claudeMirror.sessionEndSummary",
  # Smart Search
  "claudeMirror.smartSearch.open",
  "claudeMirror.smartSearch.defaultModel",
  "claudeMirror.smartSearch.allowBash"
)

foreach ($entry in $requiredManifestEntries) {
  if ($packageText -notmatch [regex]::Escape($entry)) {
    throw "Installed manifest is missing expected entry: $entry"
  }
}

$requiredBundleSymbols = @(
  "sendFilePathToChat",
  "carryCodexToClaudeCode",
  # Phase A: tab folder commands + tree view (string literals survive minification)
  "claudeMirror.sessionsTree",
  "claudeMirror.groups.create",
  "claudeMirror.tabs.focus",
  "claudeMirror.tabGroups",
  # Phase B: end-of-session summarizer (setting name + WebviewBridge hook name)
  "sessionEndSummary",
  "requestEndOfSessionSummary",
  # Smart Search: command + the configureSearchMode entry point + the
  # OPEN_SESSION token the agent emits in result cards.
  "claudeMirror.smartSearch.open",
  "configureSearchMode",
  "OPEN_SESSION"
)

foreach ($symbol in $requiredBundleSymbols) {
  if (-not (Select-String -Path $bundlePath -Pattern $symbol -Quiet)) {
    throw "Installed extension.js does not contain expected symbol: $symbol"
  }
}

Write-Host "Installed extension verified:"
Write-Host "  Path: $($installed.FullName)"
Write-Host "  LastWriteTime: $($installed.LastWriteTime)"
Write-Host "  Manifest + runtime checks: OK"
