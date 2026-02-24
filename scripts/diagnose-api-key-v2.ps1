# ClaUi API Key Diagnostic v2 - Deep check
# Usage: powershell -ExecutionPolicy Bypass -File diagnose-api-key-v2.ps1

$ErrorActionPreference = "SilentlyContinue"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ClaUi Deep Diagnostic v2" -ForegroundColor Cyan
Write-Host "  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Find the ACTUAL extension directory
Write-Host "--- 1. Extension Installation ---" -ForegroundColor Yellow
$extDir = "$env:USERPROFILE\.vscode\extensions"
Write-Host "  Extensions root: $extDir"

# Search with wildcard for any match
$claui = Get-ChildItem $extDir -Directory -Filter "*claude-code-mirror*" 2>$null
if (-not $claui) {
    # Try broader search
    $claui = Get-ChildItem $extDir -Directory | Where-Object { $_.Name -match "claude.*mirror|jhonbar" }
}

if ($claui) {
    foreach ($dir in $claui) {
        Write-Host "  Found: $($dir.Name)" -ForegroundColor Green
        Write-Host "  Full path: $($dir.FullName)"

        $pkgJson = Join-Path $dir.FullName "package.json"
        if (Test-Path $pkgJson) {
            $pkg = Get-Content $pkgJson -Raw | ConvertFrom-Json
            Write-Host "  Version: $($pkg.version)" -ForegroundColor Cyan
            Write-Host "  Display Name: $($pkg.displayName)"
            Write-Host "  Publisher: $($pkg.publisher)"
        }

        # Check dist/extension.js for envUtils code
        $distExt = Join-Path $dir.FullName "dist\extension.js"
        if (Test-Path $distExt) {
            $fileSize = (Get-Item $distExt).Length
            Write-Host "  dist/extension.js size: $([math]::Round($fileSize/1024, 1)) KB"

            $content = Get-Content $distExt -Raw

            # Check for NEW code markers
            $hasBuildSanitizedEnv = $content -match "buildSanitizedEnv"
            $hasBuildClaudeCliEnv = $content -match "buildClaudeCliEnv"
            $hasDeleteEnvCase = $content -match "deleteEnvCaseInsensitive|toUpperCase"
            $hasApiKeySetting = $content -match "apiKeySetting"
            $hasSetApiKey = $content -match "setApiKey"

            Write-Host ""
            Write-Host "  === NEW envUtils code present? ===" -ForegroundColor Cyan
            Write-Host "  buildSanitizedEnv:         $hasBuildSanitizedEnv" -ForegroundColor $(if ($hasBuildSanitizedEnv) { "Green" } else { "Red" })
            Write-Host "  buildClaudeCliEnv:         $hasBuildClaudeCliEnv" -ForegroundColor $(if ($hasBuildClaudeCliEnv) { "Green" } else { "Red" })
            Write-Host "  deleteEnvCaseInsensitive:  $hasDeleteEnvCase" -ForegroundColor $(if ($hasDeleteEnvCase) { "Green" } else { "Red" })
            Write-Host "  apiKeySetting message:     $hasApiKeySetting" -ForegroundColor $(if ($hasApiKeySetting) { "Green" } else { "Red" })
            Write-Host "  setApiKey handler:         $hasSetApiKey" -ForegroundColor $(if ($hasSetApiKey) { "Green" } else { "Red" })

            # Count raw ...process.env patterns (should be minimal or 0 with new code)
            $spreadCount = ([regex]::Matches($content, '\.\.\.process\.env')).Count
            Write-Host ""
            Write-Host "  Raw '...process.env' count: $spreadCount" -ForegroundColor $(if ($spreadCount -le 1) { "Green" } else { "Red" })

            if (-not $hasBuildSanitizedEnv) {
                Write-Host ""
                Write-Host "  >>> OLD VERSION DETECTED! envUtils code is NOT in the bundle <<<" -ForegroundColor Red
                Write-Host "  >>> The extension needs to be rebuilt with the new code <<<" -ForegroundColor Red
            }
        } else {
            Write-Host "  [!] dist/extension.js NOT FOUND!" -ForegroundColor Red
        }

        # Check webview bundle too
        $distWeb = Join-Path $dir.FullName "dist\webview.js"
        if (Test-Path $distWeb) {
            $webContent = Get-Content $distWeb -Raw
            $hasApiKeyUI = $webContent -match "apiKeySetting|maskedApiKey|handleSaveApiKey|handleClearApiKey"
            Write-Host ""
            Write-Host "  Webview has API Key UI: $hasApiKeyUI" -ForegroundColor $(if ($hasApiKeyUI) { "Green" } else { "Red" })
        }
    }
} else {
    Write-Host "  [!] Extension NOT FOUND in $extDir" -ForegroundColor Red
    Write-Host "  Listing all directories for manual inspection:"
    Get-ChildItem $extDir -Directory | Select-Object Name | Format-Table -AutoSize
}

Write-Host ""

# 2. Check what Claude Code injects
Write-Host "--- 2. Environment Injection Analysis ---" -ForegroundColor Yellow
Write-Host "  ANTHROPIC_API_KEY source:"
$processKey = $env:ANTHROPIC_API_KEY
if ($processKey) {
    $masked = $processKey.Substring(0, [Math]::Min(10, $processKey.Length)) + "****"
    Write-Host "    Present in process: $masked (len=$($processKey.Length))" -ForegroundColor Yellow

    # Check if VS Code was launched from inside Claude Code
    $ssePort = $env:CLAUDE_CODE_SSE_PORT
    if ($ssePort) {
        Write-Host "    CLAUDE_CODE_SSE_PORT=$ssePort -- VS Code is running INSIDE a Claude Code session" -ForegroundColor Red
        Write-Host "    >>> Claude Code injects ANTHROPIC_API_KEY into this terminal <<<" -ForegroundColor Red
    }
} else {
    Write-Host "    Not present in process env" -ForegroundColor Green
}

Write-Host ""

# 3. Test: what does `claude` actually use for auth?
Write-Host "--- 3. Claude CLI Auth Test ---" -ForegroundColor Yellow
$claudePath = Get-Command claude 2>$null
if ($claudePath) {
    Write-Host "  Testing: claude -p 'say hello' (5s timeout)..."

    # Run a quick test without the API key
    $testEnv = @{}
    foreach ($key in [System.Environment]::GetEnvironmentVariables("Process").Keys) {
        if ($key -ne "ANTHROPIC_API_KEY") {
            $testEnv[$key] = [System.Environment]::GetEnvironmentVariable($key, "Process")
        }
    }

    Write-Host ""
    Write-Host "  Test A: WITH ANTHROPIC_API_KEY (current state):"
    $resultA = $null
    try {
        $proc = Start-Process -FilePath "claude" -ArgumentList "-p", "respond with just the word HELLO" -NoNewWindow -PassThru -RedirectStandardOutput "$env:TEMP\claui_test_a.txt" -RedirectStandardError "$env:TEMP\claui_test_a_err.txt"
        $proc | Wait-Process -Timeout 15
        if (-not $proc.HasExited) { $proc.Kill() }
        $resultA = Get-Content "$env:TEMP\claui_test_a.txt" -Raw 2>$null
        $errA = Get-Content "$env:TEMP\claui_test_a_err.txt" -Raw 2>$null
        Write-Host "    Exit code: $($proc.ExitCode)"
        if ($resultA) { Write-Host "    Output: $($resultA.Trim().Substring(0, [Math]::Min(200, $resultA.Trim().Length)))" -ForegroundColor Green }
        if ($errA) { Write-Host "    Stderr: $($errA.Trim().Substring(0, [Math]::Min(300, $errA.Trim().Length)))" -ForegroundColor Red }
    } catch {
        Write-Host "    Error: $_" -ForegroundColor Red
    }

    Write-Host ""
    Write-Host "  Test B: WITHOUT ANTHROPIC_API_KEY (simulating envUtils sanitization):"
    try {
        # Temporarily remove the key
        $savedKey = $env:ANTHROPIC_API_KEY
        $env:ANTHROPIC_API_KEY = $null
        [System.Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", $null, "Process")

        $proc = Start-Process -FilePath "claude" -ArgumentList "-p", "respond with just the word HELLO" -NoNewWindow -PassThru -RedirectStandardOutput "$env:TEMP\claui_test_b.txt" -RedirectStandardError "$env:TEMP\claui_test_b_err.txt"
        $proc | Wait-Process -Timeout 15
        if (-not $proc.HasExited) { $proc.Kill() }
        $resultB = Get-Content "$env:TEMP\claui_test_b.txt" -Raw 2>$null
        $errB = Get-Content "$env:TEMP\claui_test_b_err.txt" -Raw 2>$null
        Write-Host "    Exit code: $($proc.ExitCode)"
        if ($resultB) { Write-Host "    Output: $($resultB.Trim().Substring(0, [Math]::Min(200, $resultB.Trim().Length)))" -ForegroundColor Green }
        if ($errB) { Write-Host "    Stderr: $($errB.Trim().Substring(0, [Math]::Min(300, $errB.Trim().Length)))" -ForegroundColor Red }

        # Restore
        $env:ANTHROPIC_API_KEY = $savedKey
    } catch {
        Write-Host "    Error: $_" -ForegroundColor Red
        $env:ANTHROPIC_API_KEY = $savedKey
    }
} else {
    Write-Host "  'claude' not found in PATH" -ForegroundColor Red
}

Write-Host ""

# 4. Check ClaUi logs (broader search)
Write-Host "--- 4. ClaUi Logs ---" -ForegroundColor Yellow
$globalStorage = "$env:APPDATA\Code\User\globalStorage"
$clauiStorage = Get-ChildItem $globalStorage -Directory -Filter "*claude*" 2>$null
if ($clauiStorage) {
    foreach ($dir in $clauiStorage) {
        Write-Host "  Storage dir: $($dir.Name)"
        $logDirs = Get-ChildItem $dir.FullName -Directory -Recurse -Filter "*log*" 2>$null
        if ($logDirs) {
            foreach ($logDir in $logDirs) {
                Write-Host "  Log dir: $($logDir.FullName)"
                $logs = Get-ChildItem $logDir.FullName -File 2>$null | Sort-Object LastWriteTime -Descending | Select-Object -First 3
                foreach ($log in $logs) {
                    Write-Host "    $($log.Name) ($($log.LastWriteTime)) $([math]::Round($log.Length/1024, 1))KB"
                }
            }
        }
    }
} else {
    Write-Host "  No Claude-related globalStorage found"
}

# Also check Output channel logs
Write-Host ""
Write-Host "  VS Code Output channel (if visible in terminal, paste it too)"

Write-Host ""
Write-Host "--- 5. Summary ---" -ForegroundColor Yellow
Write-Host ""
if ($claui) {
    $hasNew = $false
    foreach ($dir in $claui) {
        $distExt = Join-Path $dir.FullName "dist\extension.js"
        if (Test-Path $distExt) {
            $content = Get-Content $distExt -Raw
            $hasNew = $content -match "buildSanitizedEnv"
        }
    }
    if ($hasNew) {
        Write-Host "  Extension has NEW code (envUtils present)" -ForegroundColor Green
        Write-Host "  If error persists, the issue is AFTER env sanitization" -ForegroundColor Yellow
    } else {
        Write-Host "  Extension has OLD code (envUtils MISSING)" -ForegroundColor Red
        Write-Host "  >>> REBUILD and REINSTALL the .vsix from the updated source <<<" -ForegroundColor Red
    }
} else {
    Write-Host "  Extension NOT FOUND" -ForegroundColor Red
}

if ($env:CLAUDE_CODE_SSE_PORT) {
    Write-Host ""
    Write-Host "  WARNING: VS Code is running inside Claude Code session" -ForegroundColor Red
    Write-Host "  This injects ANTHROPIC_API_KEY into the process environment" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Done. Send full output to developer." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Cleanup temp files
Remove-Item "$env:TEMP\claui_test_*.txt" -Force 2>$null
