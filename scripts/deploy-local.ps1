$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

Push-Location $repoRoot
try {
  npm run build
  # --yes keeps npx non-interactive: on a machine that does not yet have
  # @vscode/vsce installed (it is a devDependency, so `npm install` provides it),
  # npx would otherwise prompt "Ok to proceed?" and hang under `npm run`,
  # producing an empty package with no .vsix.
  npx --yes @vscode/vsce package --allow-missing-repository

  # Find the VSIX that vsce just created (latest by write time)
  $vsixPath = Get-ChildItem -Path $repoRoot -Filter "claude-code-mirror-*.vsix" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName

  if (-not $vsixPath) {
    throw "No .vsix file found after packaging"
  }

  # Verify the packaged artifact actually contains the runtime bundle before we
  # install it. A .vsix that is missing extension/dist/extension.js installs
  # "successfully" but can never activate ("Cannot find module ...extension.js").
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($vsixPath)
  try {
    $bundleEntry = $zip.Entries | Where-Object { $_.FullName -eq "extension/dist/extension.js" } | Select-Object -First 1
    if (-not $bundleEntry) {
      throw "Packaged VSIX is missing extension/dist/extension.js: $vsixPath"
    }
    if ($bundleEntry.Length -lt 200000) {
      throw "Packaged extension.js is suspiciously small ($($bundleEntry.Length) bytes) - likely a broken build: $vsixPath"
    }
    Write-Host "VSIX integrity OK: extension/dist/extension.js present ($([math]::Round($bundleEntry.Length / 1KB)) KB uncompressed)"
  } finally {
    $zip.Dispose()
  }

  $codeCli = Get-Command code.cmd -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
  if (-not $codeCli) {
    $codeCli = Get-Command code -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
  }
  if (-not $codeCli) {
    throw "VS Code CLI was not found. Ensure 'code' or 'code.cmd' is on PATH."
  }

  & $codeCli --install-extension $vsixPath --force

  & (Join-Path $PSScriptRoot "verify-installed.ps1")

  Write-Host ""
  Write-Host "Deploy complete. Run 'Developer: Reload Window' in VS Code."
} finally {
  Pop-Location
}
