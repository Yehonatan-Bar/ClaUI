# Session Restore Feature

## Overview

The session restore feature preserves open ClaUi tabs (Claude, Codex, Happy, and Smart Search) when VS Code closes, automatically restoring them on next startup. This includes session state, tab names, and visual order.

## Core Concept

When VS Code shuts down via `closeAllTabs()`:
1. Refresh each tab's `sessionId` from its live CLI process
2. Assign `tabOrder` based on current visual position  
3. Stamp `lastFocusedAt` timestamp (updated whenever tab is focused)
4. Save snapshot entries to `workspaceState` with all metadata

On startup:
1. Read snapshot entries
2. Select top N tabs by `lastFocusedAt` (keep most recently used)
3. Guarantee active tab is always included (swap into kept set if needed)
4. Create tabs in visual order (`tabOrder` field)
5. Preserve unrestored entries for manual reopening

## Schema

**`OpenTabSnapshotEntry`** in `src/extension/session/OpenTabsSnapshot.ts`:

```typescript
interface OpenTabSnapshotEntry {
  sessionId: string;              // Unique tab identifier
  customName?: string;            // User-set tab name (if custom)
  groupId?: string;               // Parent folder in tab tree
  tabNumber: number;              // Creation sequence (fallback order)
  tabKind?: string;               // claude | codex | happy | search
  lastFocusedAt?: string;         // ISO timestamp (new)
  tabOrder?: number;              // Visual position 0-based (new)
}
```

Backwards compatible: `lastFocusedAt` and `tabOrder` are optional. Old snapshots without these fields fall back to `tabNumber` for ordering.

## Key Components

### OpenTabsSnapshot.ts
Defines the schema and snapshot storage interface. No algorithmic changes; purely schema additions.

### TabManager.ts

Core changes:

1. **Selection Strategy** (`restoreFromSnapshot` method):
   - Read `claudeMirror.restoreSessionsMaxTabs` setting (default 15, range 1-50)
   - If entries exceed max:
     - Sort by `lastFocusedAt` descending (most recent first)
     - Keep top N entries
     - Check if active tab falls outside kept set
     - If yes, swap it to guarantee inclusion
     - Re-sort by `tabOrder ?? tabNumber` for creation sequence

2. **Merge Strategy** (repopulation after partial restore):
   - Build set of restored sessionIds from live tabs
   - Clear and repopulate from live tabs
   - For unrestored entries: store as `preserved-{sessionId}` (capped at 50)
   - Clean up preserved entries when finally restored

3. **Focus Tracking**:
   - `handleTabFocused`: Update `lastFocusedAt` timestamp

4. **Shutdown Refresh**:
   - `closeAllTabs()`: Refresh sessionIds, assign `tabOrder`, save snapshot

### SessionTab.ts & CodexSessionTab.ts

Change: `prepareForLazyResume` accepts optional `nameHint` parameter to preserve custom tab names.

### MessageHandler.ts

Change: Passes `customName` to `prepareForLazyResume` when restoring tabs.

## Configuration

Setting: `claudeMirror.restoreSessionsMaxTabs`
- Type: Number
- Default: 15  
- Range: 1-50
- Description: Maximum number of tabs to restore on VS Code startup

## Testing Checklist

### Manual

1. Open 3-5 tabs with custom names, close/reopen, verify all restore with names preserved
2. Open 20+ tabs, close/reopen, verify top 15 restored with most-recently-focused kept
3. Open 20+ tabs, make tab 18 active, close/reopen, verify tab 18 included
4. Rename tab, close/reopen, verify custom name persists
5. Open 25 tabs, close/reopen, verify unrestored tabs available via restore button

### Automated

Run `npm run test -- --testPathPattern="session|restore|tabs"`

## Known Limitations

- Smart Search tabs always restored fresh
- Invalid sessionIds are skipped during restore
- Unrestored entries capped at 50

## Related Documentation

- TECHNICAL.md: System architecture overview
- TabManager.ts: Detailed selection and merge logic
- OpenTabsSnapshot.ts: Schema versioning strategy
