# Adventure Widget

Pixel-art dungeon crawler that visualizes Claude Code session activity in real-time. Each tool call, error, and success maps to an encounter: reading scrolls for Read, mining walls for Edit, dragons for 3+ consecutive errors, treasure for recovery, etc.

## Architecture

Two-layer design:
1. **Deterministic mapping** (Layer 1): Hard-coded rules convert each `TurnRecord` into an `AdventureBeat`. Instant, free, always runs.
2. **Haiku AI classification** (Layer 2, Phase 4 - not yet implemented): For ambiguous/dramatic moments only.

### Data Flow

```
CLI ResultSuccess/ResultError
    |
    v
MessageHandler.ts (result handler)
    - Builds TurnRecord (existing vitals pipeline)
    - Calls AdventureInterpreter.interpret(turn)
    - postMessage({ type: 'adventureBeat', beat })
    |
    v
useClaudeStream.ts -> addAdventureBeat(msg.beat)
    |
    v
Zustand store (adventureBeats[], capped at 100)
    |
    v
AdventureWidget.tsx (React.memo)
    - Feeds beats to AdventureEngine
    - Canvas 2D rendering at 120x120px
```

## Beat Types

Each turn produces exactly one beat. The mapping priority is:

| Priority | Condition | Beat | Room | Label |
|----------|-----------|------|------|-------|
| 1 | 3+ consecutive errors | `boss` | throne | "Boss fight!" |
| 2 | 2 consecutive errors | `monster` | lair | "Monster!" |
| 3 | Single error | `trap` | trap_room | "Trap!" |
| 4 | Success after error(s) | `treasure` | vault | "Victory!" |
| 5 | Achievement unlocked | `treasure` | vault | Achievement title |
| 6 | ExitPlanMode/AskUserQuestion | `fork` | junction | "Crossroads" |
| 7 | Write/Edit tools | `carve` | forge | "Mining the wall" |
| 8 | Bash tools | `forge` | arena | "Working the forge" |
| 9 | Read tools | `read` | library | "Reading scrolls" |
| 10 | Grep/Glob/WebSearch | `scout` | library | "Searching the map" |
| 11 | No tools + sustained success | `checkpoint` | corridor | "Safe ground" |
| 12 | No tools (default) | `wander` | corridor | "Exploring..." |

## Canvas Engine

### Rendering
- **Size**: 120x120px widget (240x240 HiDPI)
- **Tile size**: 8x8 pixels at 2x scale (15px rendered)
- **Visible area**: ~8x8 tiles
- **Palette**: 17-color PICO-8-inspired palette tuned for dark backgrounds
- **Sprites**: All pixel art defined as 2D number arrays (no external images)
- **`imageSmoothingEnabled = false`** for crisp pixel rendering

### State Machine

```
IDLE --[turnComplete]--> WALKING --[arrive]--> ENCOUNTER --[anim done]--> RESOLUTION --> WALKING/IDLE
  ^                                                                                          |
  |_________________________________________(queue empty)____________________________________|
```

| State | Visual | Duration |
|-------|--------|----------|
| IDLE | Character sits at campfire, flame flickers (2fps) | After 10s no turns |
| WALKING | Character walks to next room, 2-frame walk cycle | 0.8-1.2s |
| ENCOUNTER | Encounter animation plays in room | 1-1.5s |
| RESOLUTION | Result particles (gold, fire, sparkles) | 0.5s |

### Performance
- RAF loop runs ONLY during state transitions (WALKING/ENCOUNTER/RESOLUTION)
- Idle campfire: 2fps setInterval (not full 60fps RAF)
- Canvas is 120x120 native - trivial to repaint
- Sprite data is static const arrays (zero GC pressure)
- React component uses `React.memo` (re-renders only on new beats)
- Beat queue with fast-forward: if queue > 5, older encounters resolve at 4x speed
- Beat history capped at 100

## Room Templates

5x5 tile layouts for each room type:

| Room | Beat(s) | Description |
|------|---------|-------------|
| `library` | read, scout | Bookshelves on walls, scroll pedestal center |
| `forge` | carve | Anvil center, fire pits on sides |
| `arena` | forge | Open floor, pillars at corners |
| `junction` | fork | 2-4 exits, signpost center |
| `vault` | treasure | Chest center, gold pile decoration |
| `lair` | monster | Bones on floor, monster center |
| `trap_room` | trap | Spike pits, narrow path |
| `throne` | boss | Large boss area, pillars |
| `corridor` | checkpoint, wander | Narrow passage connecting rooms |

## Extension-Side: AdventureInterpreter

**File**: `src/extension/session/AdventureInterpreter.ts`

Converts `TurnRecord` data into `AdventureBeat` payloads. Tracks state for escalation:
- `consecutiveErrors`: Incremented on error, reset on success. Drives trap -> monster -> boss escalation.
- `consecutiveSuccesses`: Incremented on success, reset on error. Drives checkpoint detection.
- `lastTurnWasError`: Boolean for recovery (treasure) detection.

Instantiated per-tab in `SessionTab.ts`, injected into `MessageHandler` via `setAdventureInterpreter()`.

## Webview-Side Files

| File | Purpose |
|------|---------|
| `src/webview/components/Vitals/adventure/types.ts` | AdventureBeat, RoomType, engine interfaces, DEFAULT_CONFIG |
| `src/webview/components/Vitals/adventure/sprites.ts` | Palette, hero/encounter/tile sprites, drawSprite() |
| `src/webview/components/Vitals/adventure/rooms.ts` | 5x5 room templates, getRoomTemplate() |
| `src/webview/components/Vitals/adventure/dungeon.ts` | Dungeon class: map generation, corridors, camera, pathfinding |
| `src/webview/components/Vitals/adventure/AdventureEngine.ts` | State machine, RAF loop, canvas rendering, particles |
| `src/webview/components/Vitals/AdventureWidget.tsx` | React wrapper, feeds beats to engine, tooltip on hover |

## Toggle

- **Setting**: `claudeMirror.adventureWidget` (boolean, default `true`)
- **UI**: Toggle in `VitalsInfoPanel` (separate from the main vitals toggle)
- **Behavior**: Widget rendered only when both `vitalsEnabled` AND `adventureEnabled` are true
- **State**: `adventureEnabled` in Zustand store, preserved across session resets

## CSS

Styles in `src/webview/styles/global.css`:
- `.adventure-widget`: Fixed position, `top: 28px; right: 60px`, 120x120px, dark background, rounded border
- `.adventure-canvas`: `image-rendering: pixelated` for crisp pixel art
- `.adventure-tooltip`: Monospace overlay at bottom of widget, yellow text on dark background
