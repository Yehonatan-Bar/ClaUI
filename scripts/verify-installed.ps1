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
  "claudeMirror.tabs.moveActiveToGroup",
  "claudeMirror.tabs.removeActiveFromGroup",
  "view/item/context",
  "editor/title/context",
  # End-of-session summary (Phase B)
  "claudeMirror.sessionEndSummary",
  # Smart Search
  "claudeMirror.smartSearch.open",
  "claudeMirror.smartSearch.defaultModel",
  "claudeMirror.smartSearch.allowBash",
  # What's New after update (palette commands + setting)
  "claudeMirror.showWhatsNew",
  "claudeMirror.openChangelog",
  # Model council settings (Bridge Providers)
  "claudeMirror.bridge.council.enabled",
  "claudeMirror.bridge.council.members",
  "claudeMirror.bridge.council.chair",
  "claudeMirror.bridge.council.timeoutMs",
  # Bridge command-tools settings (run /code-review etc. inside bridge tabs)
  "claudeMirror.bridge.commandTools.enabled",
  "claudeMirror.bridge.commandTools.strategy",
  "claudeMirror.bridge.commandTools.offload",
  "claudeMirror.bridge.commandTools.diffBase"
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
  "OPEN_SESSION",
  # What's New: internal resync command + the banner state message type
  "claudeMirror.whatsNew.resync",
  "whatsNewState",
  # Bridge command-tools: proves the settings-mirroring code (BridgeProviderService
  # .syncConfigFile) shipped in the bundle, not just that the manifest declares it.
  "bridge.commandTools.enabled",
  "bridge.commandTools.strategy",
  "bridge.commandTools.offload",
  "bridge.commandTools.diffBase"
)

foreach ($symbol in $requiredBundleSymbols) {
  if (-not (Select-String -Path $bundlePath -Pattern $symbol -Quiet)) {
    throw "Installed extension.js does not contain expected symbol: $symbol"
  }
}

# "ClaUi: Open Changelog" opens the packaged changelog (shipped as lowercase changelog.md).
$changelogFile = Get-ChildItem -Path $installed.FullName -Filter "changelog.md" -File | Select-Object -First 1
if (-not $changelogFile) {
  throw "Installed extension is missing changelog.md (required by ClaUi: Open Changelog)"
}

# Bridge runtime bundle (spawned instead of the claude CLI for bridge tabs) must
# be packaged, and must contain the model-council backend — otherwise a bridge
# tab (or a Council tab) would fail to launch or silently run a stale runtime.
$bridgeRuntimePath = Join-Path $installed.FullName "dist\bridge-runtime\cli.js"
if (-not (Test-Path $bridgeRuntimePath)) {
  throw "Installed bridge runtime bundle not found: $bridgeRuntimePath"
}
# "CouncilBackend" is the backend class; "## Council" is the runtime-emitted
# convening header (a code string literal, not just a comment) — both are robust
# to a comment edit and prove the council code shipped in the bundle.
# "claui-commands" is the MCP server name Grok registers via mcpServers() —
# proves the Layer B wiring (registering the command-tools MCP server with
# Grok's ACP session) shipped, not just the command server itself.
foreach ($marker in @("CouncilBackend", "## Council", "claui-commands")) {
  if (-not (Select-String -Path $bridgeRuntimePath -Pattern $marker -SimpleMatch -Quiet)) {
    throw "Installed bridge runtime is missing expected marker: $marker"
  }
}

# Bridge command-tools MCP server (Layer B — exposes /code-review etc. as
# tools for Grok) is a separate webpack entry; must be packaged alongside cli.js.
$commandServerPath = Join-Path $installed.FullName "dist\bridge-runtime\mcp\command-server.js"
if (-not (Test-Path $commandServerPath)) {
  throw "Installed bridge command-tools MCP server not found: $commandServerPath"
}
foreach ($marker in @("claui_code_review", "notifications/initialized")) {
  if (-not (Select-String -Path $commandServerPath -Pattern $marker -SimpleMatch -Quiet)) {
    throw "Installed command-server.js is missing expected marker: $marker"
  }
}

Write-Host "Installed extension verified:"
Write-Host "  Path: $($installed.FullName)"
Write-Host "  LastWriteTime: $($installed.LastWriteTime)"
Write-Host "  Manifest + runtime checks: OK"
