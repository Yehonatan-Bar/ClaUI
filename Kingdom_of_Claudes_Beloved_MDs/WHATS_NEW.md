# What's New After Update

Tells users when a ClaUi release ships new features. Three surfaces work together:

1. **One-time VS Code toast** after the extension updates ("ClaUi updated to X: <title>") with the buttons `What's New`, `Full changelog`, `Dismiss`.
2. **Bundled announcements file** that gates the whole thing: only releases with an entry announce anything. Bug-fix-only releases stay silent.
3. **In-panel banner** at the top of the chat view listing the highlights, with `Full changelog` and `Dismiss`. Dismissal is persisted and applies to every tab and every future reload.

No network access is involved. Everything ships inside the VSIX.

## Key files

| File | Role |
|------|------|
| `src/extension/whatsnew/announcements.json` | The catalog the developer edits. Bundled into `dist/extension.js` by webpack (JSON import). |
| `src/extension/whatsnew/whatsNewLogic.ts` | Pure selection logic (no `vscode` import): version parsing, validation, eligibility, persisted-state math. |
| `src/extension/whatsnew/whatsNewCore.ts` | Orchestration behind injected ports: serialized queue, tab fan-out, toast routing, dismiss, palette command, per-tab resync. |
| `src/extension/whatsnew/WhatsNewService.ts` | VS Code adapter: globalState, toast, changelog preview, `wireWhatsNew()` (commands + TabManager hookup). |
| `src/extension/whatsnew/toastReceipt.ts` | Exclusive receipt file that makes the toast at-most-once across windows (pure Node, tested with a temp dir). |
| `src/extension/session/TabManager.ts` | Holds `whatsNewService`, registers each Claude/Codex tab as a broadcast target, exposes `revealChatTabForNotice()`. |
| `src/extension/webview/MessageHandler.ts`, `CodexMessageHandler.ts` | Route the three webview requests to the internal commands. |
| `src/webview/components/WhatsNew/WhatsNewBanner.tsx` | The banner component (rendered in `App.tsx` chat branch, above the chat area). Per entry: English title + bullets first, then the Hebrew title + bullets in an RTL block. |
| `src/webview/state/store.ts` | `whatsNewItems`, `whatsNewVersion`, `setWhatsNewState`. |
| `src/webview/hooks/useClaudeStream.ts` | Handles `whatsNewState`; posts `whatsNewRequestState` on every mount. |
| `tests/unit/whatsNewLogic.test.ts`, `whatsNewCore.test.ts`, `whatsNewReceipt.test.ts` | Unit tests (`npm run test:whats-new`). |

## How to announce a feature (developer workflow)

This is step 4 of the project `CLAUDE.md` post-development checklist and is **mandatory after every user-visible feature or capability change**. Bug fixes, refactors and internal changes get no entry. A release without a new entry never notifies anyone.

1. Add ONE entry to `src/extension/whatsnew/announcements.json`:

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

2. Field rules:
   - `id`: unique and immutable, `YYYY-MM-DD-kebab-slug`. Dismissals are keyed by it, so renaming a shipped id re-announces it.
   - `version`: the current `package.json` version. It is the **earliest** version allowed to show the entry, not an exact match; `vsce publish patch` may assign a higher number and the entry still shows.
   - `date`: today, ISO.
   - `title` / `titleHe`: the capability in 2 to 6 words.
   - `highlights` / `highlightsHe`: 1 to 4 bullets, one sentence each, about 20 words max. Same points, same order in both languages. English is written first; Hebrew is its translation. The banner renders the English block first and the Hebrew block below it (right-to-left).
   - Entries with a missing `id`, `title`, or a non-numeric `version` are ignored and counted in the `Output -> ClaUi` log. Malformed Hebrew fields never drop an entry; it simply renders English only.

3. Content rules (what users want to know, nothing else):
   - Say what the new capability is, what it does for the user, and how to reach it (button, menu, command, or setting name).
   - Add where it shows up, when it triggers, and how to turn it off when that applies.
   - Never mention implementation details, file/class/function names, bug fixes, refactors, internal architecture, or marketing adjectives.
   - Several features in one release: one entry, one bullet per feature (max 4; pick the ones users care about).

4. Add the matching entry at the top of `CHANGELOG.md` (the `Full changelog` button opens that file).
5. Publish as usual (`vsce publish patch`).

## Runtime behavior

### Activation (`WhatsNewCore.checkOnActivation`)

Input: the installed version from `context.extension.packageJSON.version`, the persisted state, the bundled catalog, `isExistingInstall`, and the `claudeMirror.showWhatsNew` setting.

| Term | Meaning |
|------|---------|
| eligible | Valid entries whose `version` is at or below the installed version, newest first |
| newly discovered | Eligible ids not yet in `knownIds` |
| pending | Eligible ids not in `dismissedIds`, capped to the newest 3 (what the banner shows) |

Decision table:

| Situation | Persisted result | Banner | Toast |
|-----------|------------------|--------|-------|
| Fresh install (`isExistingInstall` false) | eligible ids added to `knownIds` and `dismissedIds` | hidden | none |
| Setting off | eligible ids added to both sets (no backlog when re-enabled) | hidden | none |
| Existing install, nothing newly discovered | `knownIds` unchanged | pending entries (if any not dismissed) | none |
| Existing install, newly discovered entries | new ids added to `knownIds` | pending entries | once, if the receipt is claimed |

`isExistingInstall` is `claui.hasLaunched || storedSessions.length > 0`, read in `extension.ts` before the first-install logic can flip `claui.hasLaunched`.

Invalid installed version (not numeric): logged, nothing written, nothing shown.

### Persistence

Single globalState key `claui.whatsNew.state` holding `{ knownIds: string[], dismissedIds: string[] }`. Both arrays only grow. Before every write the service re-reads the stored value, unions it with the new one, and derives the banner from the committed result, so a dismissal made in another window between read and write is honored. A downgrade hides entries above the installed version but never removes ids, so re-upgrading does not re-announce.

### Toast at-most-once across windows

globalState has no compare-and-set, so the toast claim is an exclusive file create (`fs.open(..., 'wx')`) at `<globalStorage>/whats-new/toast-<version>.receipt` (`toastReceipt.ts`). `EEXIST` on the open means another window already showed it. Directory-creation failures and any other filesystem error are logged and the toast is shown anyway (fail open).

Toast buttons:

- `What's New`: `TabManager.revealChatTabForNotice()` reveals an awake ordinary chat tab (Claude or Codex), or creates a Claude tab. Smart Search and Multi-Participant tabs are never used, and neither is any sleeping tab (deep or light hibernation, lazy restore, armed silent resume), because revealing one would spawn its CLI.
- `Full changelog`: opens the packaged changelog in the markdown preview (falls back to a text editor if the preview command is unavailable). The VSIX ships the file as lowercase `changelog.md`; `CHANGELOG.md` is tried second.
- `Dismiss`: same as the banner's Dismiss.
- Closing the toast without choosing keeps the banner pending.

### Banner lifecycle

- `TabManager` registers every Claude and Codex tab with the service right after creation. Registration sends the current state immediately (queued until the webview is ready).
- The webview posts `whatsNewRequestState` on every mount. `resendTo(tabId)` re-reads storage first, which covers webview reloads, deep-hibernation wakes (those tabs drop broadcasts), and dismissals made from another VS Code window.
- `Dismiss` (banner or toast) adds every eligible id to `dismissedIds` and broadcasts an empty state to all tabs. The banner clears itself optimistically before the round trip.
- Turning `claudeMirror.showWhatsNew` off at runtime dismisses immediately.
- All mutations run through one promise queue inside `WhatsNewCore`, so activation, dismiss, the palette command and resyncs cannot interleave.

### Commands

| Command | Palette | Behavior |
|---------|---------|----------|
| `claudeMirror.showWhatsNew` ("ClaUi: What's New") | yes | Shows the newest eligible entries in a chat tab even if dismissed or the setting is off. On a build whose version is below every entry it previews the newest bundled entry, which is how a `deploy:local` build can be checked before publishing. |
| `claudeMirror.openChangelog` ("ClaUi: Open Changelog") | yes | Opens the packaged changelog preview. |
| `claudeMirror.whatsNew.dismiss` | hidden | Internal target for the webview's `whatsNewDismiss`. |
| `claudeMirror.whatsNew.resync` (tabId) | hidden | Internal target for the webview's `whatsNewRequestState`. |

### Messages

| Direction | Type | Payload |
|-----------|------|---------|
| extension -> webview | `whatsNewState` | `items: WhatsNewAnnouncement[]` (empty hides the banner), `currentVersion` |
| webview -> extension | `whatsNewDismiss` | none |
| webview -> extension | `whatsNewOpenChangelog` | none |
| webview -> extension | `whatsNewRequestState` | none (sent on mount) |

`WhatsNewAnnouncement` (`id`, `version`, `date?`, `title`, `highlights`, `titleHe?`, `highlightsHe?`) is defined in `src/extension/types/webview-messages.ts` and shared by the catalog validation, the service and the store.

## Setting

| Setting | Default | Scope | Description |
|---------|---------|-------|-------------|
| `claudeMirror.showWhatsNew` | `true` | application | Automatic toast + banner after an update. Off = silent; the palette command still works. |

## Testing

```bash
npm run test:whats-new
```

- `whatsNewLogic.test.ts`: version parsing and comparison, catalog validation and ordering, fresh install, first release of the feature on an existing install, skipped releases and the cap, future entries, same-version reinstall, JSON version below the published version, setting off, dismissed ids, downgrade, invalid installed version.
- `whatsNewCore.test.ts` (fake ports): activation broadcast + toast, fresh install, receipt already claimed, every toast button, toast closed, late tab registration, setting off and later on, runtime setting toggle, dismiss racing activation, cross-window dismissal between read and write, resync after a cross-window dismissal, palette command after dismissal and on a dev build, invalid version, throwing tab sender.
- `whatsNewReceipt.test.ts` (real temp directory): first claim wins, second loses, per-version independence, directory auto-creation, directory blocked by a file fails open, concurrent claims yield one winner.

Manual check after `npm run deploy:local` + reload: the first activation of an existing install shows the toast and the banner in every open chat tab (the bundled entry's `version` is at or below the current `package.json` version). `Dismiss` in one tab clears all tabs; a new tab stays clean; `ClaUi: What's New` brings it back; `Full changelog` opens the preview.

## Known limitations

- A banner already rendered in another VS Code window is not cleared live by a dismissal here; that window catches up on its next webview mount or activation.
- The toast receipt is best effort. If the filesystem refuses the receipt, two windows activating simultaneously may both toast once.
- globalState has no compare-and-set. Two windows writing the state at the same instant can drop one side's ids; the worst case is one extra, dismissible banner.
- Multi-Participant and Smart Search tabs do not render the banner by design.
