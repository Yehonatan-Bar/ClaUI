# git-push.ps1 - Add all, commit with session name, and push to remote
# Usage: npm run git:push
#   or:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/git-push.ps1 -Message "your message"

param(
    [string]$Message
)

# NOTE: Do NOT set $ErrorActionPreference = "Stop" here. git writes progress and
# warnings (e.g. "LF will be replaced by CRLF") to stderr even on success; under
# "Stop" that stderr can abort the script on an otherwise-successful (exit 0)
# call. We drive control flow off $LASTEXITCODE instead, and surface real
# failures on STDERR so the VS Code extension can display them (the extension
# reads stderr; anything written to stdout via Write-Host is not shown to the
# user on failure).
$ErrorActionPreference = "Continue"

# Colors for output (stdout - informational only)
function Write-Step($text)  { Write-Host "  -> $text" -ForegroundColor Cyan }
function Write-Ok($text)    { Write-Host "  OK $text" -ForegroundColor Green }

# Failures go to STDERR so the caller surfaces the real reason, then exit non-zero.
function Fail($text) {
    [Console]::Error.WriteLine("git-push failed: $text")
    exit 1
}

# 1. Check for changes
$status = git status --porcelain
if ($LASTEXITCODE -ne 0) {
    Fail "git status failed (exit $LASTEXITCODE). Is this a git repository with git on PATH?"
}
if (-not $status) {
    Write-Ok "Nothing to commit - working tree clean."
    exit 0
}

# 2. Show what will be committed
Write-Host ""
Write-Host "Changes to commit:" -ForegroundColor Yellow
git status --short
Write-Host ""

# 3. Get commit message
if ($Message) {
    $commitMessage = $Message
} else {
    # Prompt user for session/task name (interactive use only)
    $commitMessage = Read-Host "Enter session/task name for commit message"
    if (-not $commitMessage -or -not $commitMessage.Trim()) {
        Fail "Commit message cannot be empty."
    }
}

# 4. Stage all changes (capture output so a real failure is reported, not swallowed)
Write-Step "Staging all changes..."
$addOutput = (git add -A 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
    Fail "git add failed (exit $LASTEXITCODE): $addOutput"
}
Write-Ok "All changes staged."

# 5. Commit
Write-Step "Committing: $commitMessage"
$commitOutput = (git commit -m $commitMessage 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
    Fail "git commit failed (exit $LASTEXITCODE): $commitOutput"
}
Write-Ok "Committed. $commitOutput"

# 6. Push
Write-Step "Pushing to remote..."
$pushOutput = (git push 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
    Fail "git push failed (exit $LASTEXITCODE): $pushOutput`nYou may need to pull first or check your git credentials."
}

Write-Host ""
Write-Ok "Done! All changes committed and pushed."
if ($pushOutput) { Write-Host $pushOutput }
Write-Host ""
