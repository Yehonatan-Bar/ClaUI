$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$vsixPath = Join-Path $repoRoot "claude-code-mirror-0.1.0.vsix"

Push-Location $repoRoot
try {
  npm run build
  npx vsce package --allow-missing-repository
  code --install-extension $vsixPath --force

  & (Join-Path $PSScriptRoot "verify-installed.ps1")

  Write-Host ""
  Write-Host "Deploy complete. Run 'Developer: Reload Window' in VS Code."
} finally {
  Pop-Location
}
