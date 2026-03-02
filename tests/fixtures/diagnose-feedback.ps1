#############################################################################
# ClaUi Feedback Button Diagnostic Script
# Run in PowerShell: .\diagnose-feedback.ps1 | Tee-Object -FilePath diag.txt
#############################################################################

$ErrorActionPreference = 'SilentlyContinue'
$divider = "`n" + ("=" * 60)

Write-Host "$divider"
Write-Host "  ClaUi Feedback Button Diagnostics"
Write-Host "  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host $divider

# --- 1. VS Code version ---
Write-Host "`n[1] VS Code Version"
$codePath = Get-Command code -ErrorAction SilentlyContinue
if ($codePath) {
    $vsVer = & code --version 2>&1
    Write-Host "  Path : $($codePath.Source)"
    Write-Host "  Version output:"
    $vsVer | ForEach-Object { Write-Host "    $_" }
} else {
    Write-Host "  WARNING: 'code' not found on PATH"
}

# --- 2. Extension installation ---
Write-Host "`n[2] ClaUi Extension Status"
$extensions = & code --list-extensions --show-versions 2>&1
$claui = $extensions | Where-Object { $_ -match 'claude-code-mirror' }
if ($claui) {
    Write-Host "  Installed: $claui"
} else {
    Write-Host "  ERROR: ClaUi extension NOT found in installed extensions"
    Write-Host "  All extensions:"
    $extensions | ForEach-Object { Write-Host "    $_" }
}

# --- 3. Extension directory check ---
Write-Host "`n[3] Extension Files on Disk"
$extDirs = Get-ChildItem "$env:USERPROFILE\.vscode\extensions" -Directory | Where-Object { $_.Name -match 'claude-code-mirror' }
if ($extDirs) {
    foreach ($dir in $extDirs) {
        Write-Host "  Dir: $($dir.FullName)"
        $pkg = Join-Path $dir.FullName "package.json"
        if (Test-Path $pkg) {
            $json = Get-Content $pkg -Raw | ConvertFrom-Json
            Write-Host "    package.json version : $($json.version)"
            # Check command registration
            $fbCmd = $json.contributes.commands | Where-Object { $_.command -eq 'claudeMirror.sendFeedback' }
            if ($fbCmd) {
                Write-Host "    sendFeedback command : REGISTERED ('$($fbCmd.title)')"
            } else {
                Write-Host "    sendFeedback command : MISSING from package.json!"
            }
            # Check issue reporter
            $issueRep = $json.contributes | Select-Object -ExpandProperty issueUriProvider -ErrorAction SilentlyContinue
            Write-Host "    issueUriProvider     : $(if ($issueRep) { 'present' } else { 'missing' })"
        } else {
            Write-Host "    package.json: NOT FOUND"
        }
        # Check dist files exist
        $distExt = Join-Path $dir.FullName "dist\extension.js"
        $distWeb = Join-Path $dir.FullName "dist\webview.js"
        Write-Host "    dist/extension.js    : $(if (Test-Path $distExt) { 'OK (' + (Get-Item $distExt).Length + ' bytes, ' + (Get-Item $distExt).LastWriteTime + ')' } else { 'MISSING' })"
        Write-Host "    dist/webview.js      : $(if (Test-Path $distWeb) { 'OK (' + (Get-Item $distWeb).Length + ' bytes, ' + (Get-Item $distWeb).LastWriteTime + ')' } else { 'MISSING' })"
    }
} else {
    Write-Host "  ERROR: No claude-code-mirror extension directory found"
}

# --- 4. ClaUi Output Channel logs (recent) ---
Write-Host "`n[4] Recent ClaUi Logs (Output Channel)"
$logBase = "$env:APPDATA\Code\logs"
if (Test-Path $logBase) {
    # Find the most recent session's ClaUi log
    $logFiles = Get-ChildItem $logBase -Recurse -Filter "*ClaUi*" | Sort-Object LastWriteTime -Descending | Select-Object -First 3
    if ($logFiles) {
        foreach ($lf in $logFiles) {
            Write-Host "  Log: $($lf.FullName) ($(($lf.LastWriteTime).ToString('yyyy-MM-dd HH:mm')))"
            $content = Get-Content $lf.FullName -Tail 40 -ErrorAction SilentlyContinue
            $feedbackLines = $content | Where-Object { $_ -match 'feedback|openFeedback|sendFeedback|bugReport' }
            if ($feedbackLines) {
                Write-Host "  Feedback-related lines:"
                $feedbackLines | ForEach-Object { Write-Host "    $_" }
            } else {
                Write-Host "  (no feedback-related lines in last 40 lines)"
            }
        }
    } else {
        Write-Host "  No ClaUi log files found"
    }
} else {
    Write-Host "  VS Code logs directory not found at $logBase"
}

# --- 5. Extension-managed logs ---
Write-Host "`n[5] Extension-Managed Logs (globalStorage)"
$gsLogs = "$env:APPDATA\Code\User\globalStorage\claude-code-mirror.claude-code-mirror\logs\ClaUiLogs"
if (Test-Path $gsLogs) {
    $recentLogs = Get-ChildItem $gsLogs -File | Sort-Object LastWriteTime -Descending | Select-Object -First 2
    foreach ($rl in $recentLogs) {
        Write-Host "  Log: $($rl.Name) ($($rl.LastWriteTime.ToString('yyyy-MM-dd HH:mm')), $($rl.Length) bytes)"
        $tail = Get-Content $rl.FullName -Tail 30 -ErrorAction SilentlyContinue
        $errorLines = $tail | Where-Object { $_ -match 'error|exception|fail|feedback|openFeedback' }
        if ($errorLines) {
            Write-Host "  Error/feedback lines:"
            $errorLines | ForEach-Object { Write-Host "    $_" }
        } else {
            Write-Host "  (no error/feedback lines in last 30 lines)"
        }
    }
} else {
    Write-Host "  globalStorage logs directory not found"
}

# --- 6. Webview Developer Tools check hint ---
Write-Host "`n[6] Webview Status Bar Check"
Write-Host "  (Manual step: ask user to open Webview Developer Tools)"
Write-Host "  Ctrl+Shift+P -> 'Developer: Open Webview Developer Tools'"
Write-Host "  Then run in the console:"
Write-Host "    document.querySelectorAll('.status-bar-feedback-btn').length"
Write-Host "    document.querySelectorAll('[class*=feedback]').length"

# --- 7. Settings that might affect behavior ---
Write-Host "`n[7] ClaUi Settings"
$settingsPath = "$env:APPDATA\Code\User\settings.json"
if (Test-Path $settingsPath) {
    $settings = Get-Content $settingsPath -Raw
    $clauiSettings = ($settings | Select-String -Pattern '"claudeMirror\.[^"]*"' -AllMatches).Matches.Value
    if ($clauiSettings) {
        Write-Host "  ClaUi-related settings found:"
        $clauiSettings | ForEach-Object { Write-Host "    $_" }
        # Show the actual values
        $settingsJson = $settings | ConvertFrom-Json
        $settingsJson.PSObject.Properties | Where-Object { $_.Name -match '^claudeMirror\.' } | ForEach-Object {
            Write-Host "    $($_.Name) = $($_.Value)"
        }
    } else {
        Write-Host "  No claudeMirror.* settings found (all defaults)"
    }
} else {
    Write-Host "  settings.json not found at $settingsPath"
}

# --- 8. Network connectivity (Formspree) ---
Write-Host "`n[8] Network - Formspree Reachability"
try {
    $resp = Invoke-WebRequest -Uri "https://formspree.io" -Method Head -TimeoutSec 5 -UseBasicParsing
    Write-Host "  formspree.io: reachable (HTTP $($resp.StatusCode))"
} catch {
    Write-Host "  formspree.io: UNREACHABLE - $($_.Exception.Message)"
}

# --- 9. Network connectivity (GitHub) ---
Write-Host "`n[9] Network - GitHub Reachability"
try {
    $resp = Invoke-WebRequest -Uri "https://github.com/Yehonatan-Bar/ClaUI" -Method Head -TimeoutSec 5 -UseBasicParsing
    Write-Host "  GitHub repo: reachable (HTTP $($resp.StatusCode))"
} catch {
    Write-Host "  GitHub repo: UNREACHABLE - $($_.Exception.Message)"
}

# --- 10. System info ---
Write-Host "`n[10] System Info"
Write-Host "  OS          : $([System.Environment]::OSVersion.VersionString)"
Write-Host "  Machine     : $env:COMPUTERNAME"
Write-Host "  User        : $env:USERNAME"
Write-Host "  Node.js     : $(& node --version 2>&1)"
Write-Host "  npm         : $(& npm --version 2>&1)"

Write-Host "$divider"
Write-Host "  Diagnostics complete. Send the output above to the developer."
Write-Host $divider
