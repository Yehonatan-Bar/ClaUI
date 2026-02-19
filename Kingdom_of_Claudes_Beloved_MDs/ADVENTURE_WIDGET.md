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
| IDLE | Character breathes/fidgets with micro-movement, sits at campfire after 10s (4fps) | After 10s no turns |
| WALKING | Character walks zigzag path to next room, 2-frame walk cycle, 4 tiles/sec | Variable based on distance |
| ENCOUNTER | Encounter animation plays in room, hero micro-movement continues | ~1s |
| RESOLUTION | Result particles (gold, fire, sparkles) | ~0.5s |

### Movement System

**Zigzag pathfinding**: Instead of moving all-horizontal then all-vertical, the hero alternates 1-2 horizontal steps with 1-2 vertical steps, creating visible multi-directional movement even on short paths.

**L-shaped corridors**: Corridors between rooms bend at a random midpoint (30-70% along), so the hero always has at least one direction change per walk. The bend creates an L-shape or Z-shape depending on room placement.

**Balanced direction weights**: Rooms are placed in all four directions (up 20%, right 30%, down 30%, left 20%) with anti-backtracking (the reverse of the last direction is heavily penalized). This prevents monotonous right-only or down-only paths.

**Idle micro-movement**: When idle or in encounter state, the hero drifts 1-2 pixels using sine waves (`sin(phase)` for X, `sin(phase*0.7+1.2)` for Y), creating a subtle breathing/fidget effect so the widget never looks frozen.

### Performance
- RAF loop runs ONLY during state transitions (WALKING/ENCOUNTER/RESOLUTION)
- Idle loop: 4fps setInterval with micro-movement updates (not full 60fps RAF)
- Canvas is 120x120 native - trivial to repaint
- Sprite data is static const arrays (zero GC pressure)
- React component uses `React.memo` (re-renders only on new beats)
- Beat queue with fast-forward: if queue > 5, older encounters resolve instantly
- Beat history capped at 100

## Dungeon Generation

Rooms are 5x5 tiles connected by L-shaped corridors (5 tiles long). Each room is placed in a randomly chosen direction from the previous room, with anti-backtracking to prevent going back the way we came. Corridors bend at a random midpoint creating visible turns.

### Room Templates

5x5 tile layouts with interior wall details for maze-like feel:

| Room | Beat(s) | Description |
|------|---------|-------------|
| `library` | read, scout | Alternating shelves and reading nooks |
| `forge` | carve | Staggered wall segments around anvil |
| `arena` | forge | Corner pillars for cover |
| `junction` | fork | Wall stubs on all sides, open center |
| `vault` | treasure | Heavily walled, narrow entry |
| `lair` | monster | Irregular walls for organic feel |
| `trap_room` | trap | Zigzag walls creating narrow passages |
| `throne` | boss | Flanking pillars around throne |
| `corridor` | checkpoint, wander | Narrow winding passage |

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
