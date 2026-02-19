# Adventure Widget

Pixel-art dungeon crawler that visualizes Claude Code session activity in real-time. Each tool call, error, and success maps to an encounter: reading scrolls for Read, mining walls for Edit, dragons for 3+ consecutive errors, treasure for recovery, etc.

The widget renders a **thin-wall maze grid** where the hero navigates through dense corridors. Each Claude action extends the maze in a different direction, creating a visible sense of exploration and progression.

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
- **Cell size**: 10px per cell (8px passage + 2px wall line)
- **Visible area**: 12x12 cells - shows dozens of corridors, turns, dead-ends simultaneously
- **Hero sprite**: 4x4 pixels at 2x scale = 8px (fits inside 8px passages)
- **Wall rendering**: 2px `fillRect()` lines between cells (not sprite tiles)
- **Floor**: Alternating dark gray shades per cell
- **Palette**: 17-color PICO-8-inspired palette tuned for dark backgrounds
- **Sprites**: Mini 4x4 sprites for hero/encounters, 2D number arrays (no external images)
- **`imageSmoothingEnabled = false`** for crisp pixel rendering

### State Machine

```
IDLE --[turnComplete]--> WALKING --[arrive]--> ENCOUNTER --[anim done]--> RESOLUTION --> WALKING/IDLE
  ^                                                                                          |
  |_________________________________________(queue empty)____________________________________|
```

| State | Visual | Duration |
|-------|--------|----------|
| IDLE | Hero patrols through nearby maze corridors (BFS pathfinding), breathes/fidgets, ambient particles float. Sits at campfire after 20s. (8fps) | Until beats arrive or 20s for campfire |
| WALKING | Character walks BFS-computed path through maze corridors, 2-frame walk cycle, dynamic speed (4-8 cells/sec based on path length) | Variable based on distance |
| ENCOUNTER | Mini encounter sprite appears near hero, hero micro-movement continues | ~1s |
| RESOLUTION | Result particles (gold, fire, sparkles) | ~0.5s |

### Movement System

**BFS pathfinding**: Hero navigates through maze passages using breadth-first search. The path follows actual corridors through the maze, creating winding multi-directional movement.

**Dynamic walk speed**: Speed scales with path length: `speed = min(8, 4 + pathLength/10)`. Short paths are slow enough to see, long paths don't take forever.

**Idle patrol**: After ~1 second of idle, the hero picks 4-6 reachable cells within 8 BFS steps and walks through actual maze corridors between them. The patrol path is computed as BFS segments between waypoints. Pauses 1.5-3.5 seconds between patrols.

**Idle micro-movement**: When idle or in encounter state, the hero drifts 1-2 pixels using sine waves, creating a subtle breathing/fidget effect.

**Smooth camera**: Camera uses lerp interpolation: `cameraX += (targetX - cameraX) * 0.08 * dt * 60`. Creates visible scrolling through the maze instead of snapping.

**Ambient particles**: Tiny sparkle and dust mote sprites (2x2px) spawn every ~0.8 seconds and drift upward across the canvas.

**Torch glow**: Random cells marked as torches render flickering warm orange circles with a small orange dot.

### Performance
- RAF loop runs ONLY during state transitions (WALKING/ENCOUNTER/RESOLUTION)
- Idle loop: 8fps setInterval with patrol walking, micro-movement, ambient particles, smooth camera
- Canvas is 120x120 native - trivial to repaint
- Sprite data is static const arrays (zero GC pressure)
- Maze data stored as `Set<string>` (O(1) passage lookups)
- React component uses `React.memo` (re-renders only on new beats)
- Beat queue with fast-forward: if queue > 5, older encounters resolve instantly
- Beat history capped at 100

## Maze Generation

Uses **recursive backtracker** algorithm on a 40x40 cell grid:
- Walls exist by default between all cells
- Passages stored as `Set<string>` of removed wall keys (format: `"x,y,E"` for east wall, `"x,y,S"` for south wall)
- Initial generation: ~300 cells from center (grid position 20,20) to fill viewport with dense maze
- 8 torch markers placed at random visited cells for ambient glow

### Beat-to-Maze Mapping

Each Claude action extends the maze in a direction:

| Beat | Action | Direction |
|------|--------|-----------|
| scout/read | Extend maze 10-20 cells | EAST (exploring) |
| carve/forge | Extend maze 10-20 cells | SOUTH (digging deeper) |
| fork | Carve 5-10 passages in 3 directions | Multi-direction junction |
| trap/monster/boss | No extension - hero walks to dead end | Existing passages |
| treasure | Remove walls around hero (radius 2) | Creates open area |
| checkpoint | Remove walls (radius 1) + wander to random | Small cleared space + movement |
| wander | No extension - hero wanders 6-12 cells | Random walk through existing |

### Maze Extension

When extending, the engine:
1. Finds frontier cells (visited cells with unvisited neighbors) near the hero
2. Biases selection toward the preferred direction
3. Runs a small recursive backtracker generation from the frontier
4. Sets the hero target to the furthest newly-created cell
5. May add a torch marker in the new area

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
| `src/webview/components/Vitals/adventure/types.ts` | AdventureBeat, RoomType, AdventureConfig (cellSize, wallThickness, mazeWidth/Height), DEFAULT_CONFIG |
| `src/webview/components/Vitals/adventure/sprites.ts` | Palette, 8x8 sprites (legacy), 4x4 mini sprites (hero/encounter/campfire), drawSprite(), getMiniEncounterSprites() |
| `src/webview/components/Vitals/adventure/dungeon.ts` | Maze class: recursive backtracker generation, BFS pathfinding, wall-line rendering, smooth lerp camera, beat-to-maze extension |
| `src/webview/components/Vitals/adventure/AdventureEngine.ts` | State machine, RAF loop, canvas rendering, mini sprite positioning, patrol through maze corridors, particles |
| `src/webview/components/Vitals/AdventureWidget.tsx` | React wrapper, feeds beats to engine, tooltip on hover |

## Toggle

- **Setting**: `claudeMirror.adventureWidget` (boolean, default `false`)
- **UI**: Toggle in `VitalsInfoPanel` (separate from the main vitals toggle)
- **Behavior**: Widget rendered only when both `vitalsEnabled` AND `adventureEnabled` are true
- **State**: `adventureEnabled` in Zustand store, preserved across session resets

## Dragging

The widget is fully draggable via mouse:
- **Grab cursor**: Shows `grab` on hover, `grabbing` while dragging
- **Drag mechanics**: `mousedown` captures offset, `mousemove` on document updates position, `mouseup` clamps to viewport bounds and saves
- **Persistence**: Position saved to `localStorage` under key `adventure-widget-position` and restored on mount
- **Clamping**: On release, position is clamped so the widget stays fully within the viewport
- **Default position**: If no saved position exists, CSS defaults apply (`top: 28px; right: 60px`)
- **Inline style override**: When a saved/dragged position exists, `left`/`top` are set inline with `right: auto` to override the CSS default

## CSS

Styles in `src/webview/styles/global.css`:
- `.adventure-widget`: Fixed position, default `top: 28px; right: 60px`, 120x120px, dark background, rounded border, `cursor: grab`, `user-select: none`
- `.adventure-widget--dragging`: Applied during drag - `cursor: grabbing`, enhanced shadow
- `.adventure-canvas`: `image-rendering: pixelated` for crisp pixel art
- `.adventure-tooltip`: Monospace overlay at bottom of widget, yellow text on dark background
