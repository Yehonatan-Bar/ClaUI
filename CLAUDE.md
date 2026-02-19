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

## 4. Known Pitfalls

### Stale code (most common bug)

`npm run build` only updates local `dist/`. VS Code runs from `~/.vscode/extensions/`. **Always package + install** via `npm run deploy:local` - otherwise VS Code runs old code silently.

### Production build strips console.log

`npm run build` uses `webpack --mode production` with terser, which **removes all `console.log` statements**. Use `--mode development` when you need webview diagnostic logging.

### Dual webpack targets

Extension code runs in **Node.js**, webview code runs in **browser**. They are separate bundles (`dist/extension.js` and `dist/webview.js`). Don't use Node APIs in webview code or DOM APIs in extension code.

### Webview strict CSP

The webview runs in a sandboxed iframe with strict Content Security Policy. Adding new external resources (scripts, styles, images) requires updating the CSP in `WebviewProvider.ts`.

### Blank webview panel (VS Code bug, not our code)

Panel may open completely blank after reload/update. **Fix**: Open `Developer: Toggle Developer Tools` (Ctrl+Shift+I) to force repaint, then close it. Symptom: Output channel shows `Webview: creating new panel` but no `received message type="ready"`.

## 5. CLI Data Format Gotchas

Never trust CLI event field types at runtime. The TypeScript interfaces describe the *ideal* shape, not the guaranteed runtime shape.

| Gotcha | Crash site | Fix |
|--------|-----------|-----|
| User message `content` can be a plain string instead of `ContentBlock[]` | `MessageBubble` crashes on `.filter()` / `.map()` | Normalize: `typeof content === 'string' ? [{ type: 'text', text: content }] : content` |
| `cost_usd`, `total_cost_usd`, `usage` can be `undefined` | `StatusBar` crashes on `.toFixed()` | Nullish coalescing: `(cost?.costUsd ?? 0).toFixed(4)` |
| General rule | Any component consuming CLI data | Always use `?.`, `?? default`, `Array.isArray()` |

## 6. Debugging

- **Webview console**: `Developer: Open Webview Developer Tools` - shows React errors, state logs
- **Extension output**: `Output -> ClaUi` - shows process lifecycle, startup timestamps
- **Error Boundary**: React crashes display error + stack trace in the webview panel (instead of blank screen). If you see a blank screen, it's the VS Code rendering bug above, not a React crash

לתחקר תקלות עיין בלוגים האחרונים שבתקיה:
C:\Users\yoni.bar\AppData\Roaming\Code\User\globalStorage\claude-code-mirror.claude-code-mirror\logs\ClaUiLogs