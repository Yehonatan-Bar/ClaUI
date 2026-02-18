# git-push.ps1 - Add all, commit with session name, and push to remote
# Usage: npm run git:push
#   or:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/git-push.ps1

param(
    [string]$Message
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Colors for output
function Write-Step($text)  { Write-Host "  -> $text" -ForegroundColor Cyan }
function Write-Ok($text)    { Write-Host "  OK $text" -ForegroundColor Green }
function Write-Err($text)   { Write-Host "  !! $text" -ForegroundColor Red }

# 1. Check for changes
$status = git status --porcelain
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
    # Prompt user for session/task name
    $commitMessage = Read-Host "Enter session/task name for commit message"
    if (-not $commitMessage.Trim()) {
        Write-Err "Commit message cannot be empty."
        exit 1
    }
}

# 4. Stage all changes
Write-Step "Staging all changes..."
git add -A
if ($LASTEXITCODE -ne 0) {
    Write-Err "git add failed."
    exit 1
}
Write-Ok "All changes staged."

# 5. Commit
Write-Step "Committing: $commitMessage"
git commit -m $commitMessage
if ($LASTEXITCODE -ne 0) {
    Write-Err "git commit failed."
    exit 1
}
Write-Ok "Committed."

# 6. Push
Write-Step "Pushing to remote..."
git push
if ($LASTEXITCODE -ne 0) {
    Write-Err "git push failed. You may need to pull first."
    exit 1
}

Write-Host ""
Write-Ok "Done! All changes committed and pushed."
Write-Host ""
