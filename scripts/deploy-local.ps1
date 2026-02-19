$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

Push-Location $repoRoot
try {
  npm run build
  npx vsce package --allow-missing-repository

  # Find the VSIX that vsce just created (latest by write time)
  $vsixPath = Get-ChildItem -Path $repoRoot -Filter "claude-code-mirror-*.vsix" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName

  if (-not $vsixPath) {
    throw "No .vsix file found after packaging"
  }

  code --install-extension $vsixPath --force

  & (Join-Path $PSScriptRoot "verify-installed.ps1")

  Write-Host ""
  Write-Host "Deploy complete. Run 'Developer: Reload Window' in VS Code."
} finally {
  Pop-Location
}
