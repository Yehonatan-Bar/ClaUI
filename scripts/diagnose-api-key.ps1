# ClaUi API Key Diagnostic Script
# Run this on the affected machine and send the output back
# Usage: powershell -ExecutionPolicy Bypass -File diagnose-api-key.ps1

$ErrorActionPreference = "SilentlyContinue"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ClaUi API Key Diagnostic Report" -ForegroundColor Cyan
Write-Host "  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check ANTHROPIC_API_KEY in environment
Write-Host "--- 1. ANTHROPIC_API_KEY in Environment ---" -ForegroundColor Yellow

$userKey = [Environment]::GetEnvironmentVariable("ANTHROPIC_API_KEY", "User")
$machineKey = [Environment]::GetEnvironmentVariable("ANTHROPIC_API_KEY", "Machine")
$processKey = $env:ANTHROPIC_API_KEY

if ($userKey) {
    $masked = $userKey.Substring(0, [Math]::Min(8, $userKey.Length)) + "****"
    Write-Host "  [!] FOUND in User env:    $masked (length=$($userKey.Length))" -ForegroundColor Red
} else {
    Write-Host "  [OK] Not in User env" -ForegroundColor Green
}

if ($machineKey) {
    $masked = $machineKey.Substring(0, [Math]::Min(8, $machineKey.Length)) + "****"
    Write-Host "  [!] FOUND in Machine env: $masked (length=$($machineKey.Length))" -ForegroundColor Red
} else {
    Write-Host "  [OK] Not in Machine env" -ForegroundColor Green
}

if ($processKey) {
    $masked = $processKey.Substring(0, [Math]::Min(8, $processKey.Length)) + "****"
    Write-Host "  [!] FOUND in Process env: $masked (length=$($processKey.Length))" -ForegroundColor Red
} else {
    Write-Host "  [OK] Not in Process env" -ForegroundColor Green
}

# Check all case variations
Write-Host ""
Write-Host "  Case variations in current env:" -ForegroundColor Gray
$found = $false
Get-ChildItem Env: | Where-Object { $_.Name -like "*anthropic*" -or $_.Name -like "*ANTHROPIC*" } | ForEach-Object {
    $masked = $_.Value.Substring(0, [Math]::Min(8, $_.Value.Length)) + "****"
    Write-Host "    $($_.Name) = $masked" -ForegroundColor Red
    $found = $true
}
if (-not $found) {
    Write-Host "    None found" -ForegroundColor Green
}

Write-Host ""

# 2. Check other Claude-related env vars
Write-Host "--- 2. Other Claude Env Vars ---" -ForegroundColor Yellow
$claudeVars = Get-ChildItem Env: | Where-Object { $_.Name -like "*claude*" -or $_.Name -like "*CLAUDE*" }
if ($claudeVars) {
    $claudeVars | ForEach-Object {
        Write-Host "    $($_.Name) = $($_.Value)"
    }
} else {
    Write-Host "    None found" -ForegroundColor Green
}
Write-Host ""

# 3. Check installed extension
Write-Host "--- 3. Installed Extension ---" -ForegroundColor Yellow
$extDir = "$env:USERPROFILE\.vscode\extensions"
$claui = Get-ChildItem $extDir -Directory -Filter "claude-code-mirror*" 2>$null
if ($claui) {
    foreach ($dir in $claui) {
        Write-Host "  Extension dir: $($dir.Name)"
        $pkgJson = Join-Path $dir.FullName "package.json"
        if (Test-Path $pkgJson) {
            $pkg = Get-Content $pkgJson | ConvertFrom-Json
            Write-Host "  Version: $($pkg.version)"
        }
        # Check if envUtils exists in dist
        $distExt = Join-Path $dir.FullName "dist\extension.js"
        if (Test-Path $distExt) {
            $content = Get-Content $distExt -Raw
            $hasEnvUtils = $content -match "buildSanitizedEnv|buildClaudeCliEnv|deleteEnvCaseInsensitive"
            $hasOldSpread = ($content | Select-String -Pattern '\.\.\.process\.env' -AllMatches).Matches.Count
            Write-Host "  Has envUtils code: $hasEnvUtils" -ForegroundColor $(if ($hasEnvUtils) { "Green" } else { "Red" })
            Write-Host "  Raw '...process.env' occurrences: $hasOldSpread" -ForegroundColor $(if ($hasOldSpread -eq 0) { "Green" } else { "Red" })
        } else {
            Write-Host "  [!] dist/extension.js not found!" -ForegroundColor Red
        }
    }
} else {
    Write-Host "  [!] Extension not found in $extDir" -ForegroundColor Red
}
Write-Host ""

# 4. Check Claude CLI
Write-Host "--- 4. Claude CLI ---" -ForegroundColor Yellow
$claudePath = Get-Command claude 2>$null
if ($claudePath) {
    Write-Host "  Path: $($claudePath.Source)"
    $ver = & claude --version 2>&1
    Write-Host "  Version: $ver"
} else {
    Write-Host "  [!] 'claude' not found in PATH" -ForegroundColor Red
}

# Check if claude is running
$claudeProcs = Get-Process -Name "claude*" 2>$null
if ($claudeProcs) {
    Write-Host "  Running processes:"
    $claudeProcs | ForEach-Object {
        Write-Host "    PID=$($_.Id) Name=$($_.ProcessName) Started=$($_.StartTime)"
    }
} else {
    Write-Host "  No Claude processes running"
}
Write-Host ""

# 5. Check Claude config
Write-Host "--- 5. Claude Auth Config ---" -ForegroundColor Yellow
$claudeConfig = "$env:USERPROFILE\.claude\config.json"
if (Test-Path $claudeConfig) {
    Write-Host "  Config exists at: $claudeConfig"
    $cfg = Get-Content $claudeConfig | ConvertFrom-Json
    # Show auth-related fields without exposing secrets
    if ($cfg.PSObject.Properties["oauthAccount"]) {
        Write-Host "  Has oauthAccount: true" -ForegroundColor Green
    }
    if ($cfg.PSObject.Properties["primaryApiKey"]) {
        Write-Host "  Has primaryApiKey: true" -ForegroundColor Yellow
    }
    if ($cfg.PSObject.Properties["hasCompletedOnboarding"]) {
        Write-Host "  hasCompletedOnboarding: $($cfg.hasCompletedOnboarding)"
    }
} else {
    Write-Host "  [!] Config not found at $claudeConfig" -ForegroundColor Red
}

$claudeCredentials = "$env:USERPROFILE\.claude\credentials.json"
if (Test-Path $claudeCredentials) {
    Write-Host "  Credentials file exists"
    $cred = Get-Content $claudeCredentials -Raw | ConvertFrom-Json
    $cred.PSObject.Properties | ForEach-Object {
        $val = $_.Value
        if ($val -is [string] -and $val.Length -gt 10) {
            $masked = $val.Substring(0, 6) + "****"
            Write-Host "    $($_.Name): $masked (length=$($val.Length))"
        } else {
            Write-Host "    $($_.Name): $val"
        }
    }
} else {
    Write-Host "  No credentials.json found"
}
Write-Host ""

# 6. Check VS Code settings for the extension
Write-Host "--- 6. VS Code Extension Settings ---" -ForegroundColor Yellow
$settingsPath = "$env:APPDATA\Code\User\settings.json"
if (Test-Path $settingsPath) {
    $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
    $clauiSettings = $settings.PSObject.Properties | Where-Object { $_.Name -like "claudeMirror*" }
    if ($clauiSettings) {
        $clauiSettings | ForEach-Object {
            # Don't print anything that looks like a key
            $val = $_.Value
            if ($val -is [string] -and ($val -like "sk-*" -or $val -like "key-*")) {
                Write-Host "    $($_.Name): [REDACTED API KEY]" -ForegroundColor Red
            } else {
                Write-Host "    $($_.Name): $val"
            }
        }
    } else {
        Write-Host "  No claudeMirror settings found (using defaults)"
    }
} else {
    Write-Host "  Settings file not found"
}
Write-Host ""

# 7. Recent ClaUi logs
Write-Host "--- 7. Recent ClaUi Logs (last 50 lines) ---" -ForegroundColor Yellow
$logDir = "$env:APPDATA\Code\User\globalStorage\claude-code-mirror.claude-code-mirror\logs\ClaUiLogs"
if (Test-Path $logDir) {
    $latestLog = Get-ChildItem $logDir -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latestLog) {
        Write-Host "  Latest log: $($latestLog.Name) ($($latestLog.LastWriteTime))"
        Write-Host "  ---"
        # Filter for relevant lines
        $lines = Get-Content $latestLog.FullName -Tail 200
        $relevant = $lines | Where-Object {
            $_ -match "ANTHROPIC|API.?KEY|api.?key|hasAnthropicKey|Credit|balance|auth|envUtils|sanitize|buildClaudeCliEnv|buildSanitizedEnv|ERROR|error|spawn|start.*process"
        } | Select-Object -Last 50
        if ($relevant) {
            $relevant | ForEach-Object {
                # Redact any actual key values
                $line = $_ -replace '(sk-ant-[a-zA-Z0-9-]{4})[a-zA-Z0-9-]+', '$1****'
                Write-Host "  $line"
            }
        } else {
            Write-Host "  No relevant lines found in recent logs"
            Write-Host "  Last 10 lines:"
            $lines | Select-Object -Last 10 | ForEach-Object { Write-Host "  $_" }
        }
    } else {
        Write-Host "  No log files found in $logDir"
    }
} else {
    Write-Host "  [!] Log directory not found: $logDir" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Diagnostic complete." -ForegroundColor Cyan
Write-Host "  Send this output to the developer." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
