# Post-Development Checklist

**Run after EVERY code change, feature, or bug fix.**

## 1. Build & Deploy

```bash
cd C:/projects/claude-code-mirror
npm run deploy:local
```

Then reload VS Code: `Ctrl+Shift+P` -> `Developer: Reload Window`

## 2. Verify Installation

```bash
npm run verify:installed
```

**Mandatory** when adding new commands, menus, keybindings, or settings - these live in `package.json` (the extension manifest) and must be packaged to take effect.

If verification fails: re-run `npm run deploy:local`, reload, check `Output -> ClaUi` for fresh startup timestamps.

## 3. Update Documentation

- **Detail docs**: Update relevant files in `Kingdom_of_Claudes_Beloved_MDs/` to reflect current state
- **TECHNICAL.md**: Update the component index, directory structure, and any changed settings
- New component? Create a new detail doc and add an index entry in TECHNICAL.md
- Removed component? Delete its detail doc and remove the TECHNICAL.md entry
- Documentation is a **snapshot** of current state - delete anything that no longer exists

## 4. Announce the Feature (What's New)

**Mandatory after adding or changing any user-visible feature or capability. Skip for bug fixes, refactors, and internal changes.**

Add ONE entry to `src/extension/whatsnew/announcements.json`. Users see it in the post-update notification and in the What's New banner at the top of the chat panel (English block first, Hebrew block below). Detail: `Kingdom_of_Claudes_Beloved_MDs/WHATS_NEW.md`.

```json
{
  "id": "2026-10-01-pin-message",
  "version": "0.1.235",
  "date": "2026-10-01",
  "title": "Pin a message",
  "titleHe": "הצמדת הודעה",
  "highlights": [
    "Pin any chat message from its hover menu so it stays visible at the top of the conversation.",
    "Unpin it from the same menu. Pins are saved with the session."
  ],
  "highlightsHe": [
    "הצמידו כל הודעה בצ'אט מתפריט הריחוף שלה כדי שתישאר גלויה בראש השיחה.",
    "ביטול ההצמדה מאותו תפריט. ההצמדות נשמרות יחד עם הסשן."
  ]
}
```

Field rules:

- `id`: unique and immutable, format `YYYY-MM-DD-kebab-slug`. Never rename an id that shipped (dismissals are keyed by it).
- `version`: the current `package.json` version. It is the earliest version allowed to show the entry; `vsce publish patch` may publish a higher number, that is fine.
- `date`: today, ISO format.
- `title` and `titleHe`: the capability in 2 to 6 words.
- `highlights` and `highlightsHe`: 1 to 4 bullets, one sentence each, about 20 words max. Same points, same order, in both languages. Write the English first, then translate it to Hebrew.

What a bullet says: the new capability, what it does for the user, and how to reach it (button, menu, command, or setting name). Add what a user would want to know: where it shows up, when it triggers, how to turn it off.

What a bullet never says: implementation details, file/class/function names, bug-fix or refactor notes, internal architecture, marketing adjectives.

Several features in one release: still one entry, one bullet per feature (max 4, pick the ones users care about). Then add the matching entry at the top of `CHANGELOG.md` (the banner's `Full changelog` button opens it).

## 5. Known Pitfalls

### Stale code (most common bug)

`npm run build` only updates local `dist/`. VS Code runs from `~/.vscode/extensions/`. **Always package + install** via `npm run deploy:local` - otherwise VS Code runs old code silently.

### Production build strips console.log

`npm run build` uses `webpack --mode production` with terser, which **removes all `console.log` statements**. Use `--mode development` when you need webview diagnostic logging.

### Dual webpack targets

Extension code runs in **Node.js**, webview code runs in **browser**. They are separate bundles (`dist/extension.js` and `dist/webview.js`). Don't use Node APIs in webview code or DOM APIs in extension code.

### Webview strict CSP

The webview runs in a sandboxed iframe with strict Content Security Policy. Adding new external resources (scripts, styles, images) requires updating the CSP in `WebviewProvider.ts`.

### Process kill on Windows requires taskkill

`process.kill('SIGTERM')` with `shell: true` only kills the `cmd.exe` wrapper, NOT the actual Claude CLI process. The extension uses `taskkill /F /T /PID` to kill the entire process tree. If you add new spawn calls with `shell: true`, use the same `killProcessTree()` pattern from `ClaudeProcessManager.ts`.

### Blank webview panel (VS Code bug, not our code)

Panel may open completely blank after reload/update. **Fix**: Open `Developer: Toggle Developer Tools` (Ctrl+Shift+I) to force repaint, then close it. Symptom: Output channel shows `Webview: creating new panel` but no `received message type="ready"`.

## 6. CLI Data Format Gotchas

Never trust CLI event field types at runtime. The TypeScript interfaces describe the *ideal* shape, not the guaranteed runtime shape.

| Gotcha | Crash site | Fix |
|--------|-----------|-----|
| User message `content` can be a plain string instead of `ContentBlock[]` | `MessageBubble` crashes on `.filter()` / `.map()` | Normalize: `typeof content === 'string' ? [{ type: 'text', text: content }] : content` |
| `cost_usd`, `total_cost_usd`, `usage` can be `undefined` | `StatusBar` crashes on `.toFixed()` | Nullish coalescing: `(cost?.costUsd ?? 0).toFixed(4)` |
| General rule | Any component consuming CLI data | Always use `?.`, `?? default`, `Array.isArray()` |

## 7. Debugging

- **Webview console**: `Developer: Open Webview Developer Tools` - shows React errors, state logs
- **Extension output**: `Output -> ClaUi` - shows process lifecycle, startup timestamps
- **Where `Output -> ClaUi` is stored**: VS Code persists the Output channel under `%APPDATA%\Code\logs\<VS Code session>\windowN\exthost\output_logging_<timestamp>\1-ClaUi.log` (not under `globalStorage`)
- **Pick the right file**: there may be multiple `windowN` folders and multiple `output_logging_*` folders; choose the newest one that matches the repro time and active window
- **Error Boundary**: React crashes display error + stack trace in the webview panel (instead of blank screen). If you see a blank screen, it's the VS Code rendering bug above, not a React crash

- `globalStorage\...\logs\ClaUiLogs` are extension-managed logs, but they are not the same as the VS Code `Output -> ClaUi` history. For recent repros, check both.

לתחקר תקלות עיין בלוגים האחרונים שבתקיה:
C:\Users\yoni.bar\AppData\Roaming\Code\User\globalStorage\claude-code-mirror.claude-code-mirror\logs\ClaUiLogs

אם המשתמש שואל איך לפרסם עדכון או גרסה לתוסף התשובה היא שיש לשלוח את הפקודה:
vsce publish patch
