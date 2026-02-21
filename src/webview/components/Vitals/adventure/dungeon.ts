/**
 * Maze generation, pathfinding, rendering, and camera.
 * Replaces the old room+corridor Dungeon with a thin-wall maze grid.
 *
 * Maze is a grid of cells. Walls exist by default between all cells.
 * Passages are stored as removed walls in a Set<string>.
 * Wall key format: "x,y,E" (east wall of cell x,y) or "x,y,S" (south wall).
 */

import type { AdventureBeat, TilePos, AdventureConfig } from './types';
import { DEFAULT_CONFIG } from './types';
import { PALETTE } from './sprites';

/** Simple seeded random for deterministic generation */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** Directions: [dx, dy] */
const DIRS: [number, number][] = [
  [0, -1],  // 0: North
  [1, 0],   // 1: East
  [0, 1],   // 2: South
  [-1, 0],  // 3: West
];

export class Maze {
  /** Set of removed walls (passages). Key: "x,y,dir" where dir is E or S */
  passages: Set<string> = new Set();

  /** Set of visited cells during generation. Key: "x,y" */
  visited: Set<string> = new Set();

  /** Grid dimensions */
  width: number;
  height: number;

  /** Hero position in cell coordinates */
  heroPos: TilePos;

  /** Hero target position (for walking animation) */
  heroTarget: TilePos;

  /** Start position of the previous walk - used for forward-bias target scoring. */
  heroLastStart: TilePos;

  /** Smooth camera position in CSS pixels */
  cameraX = 0;
  cameraY = 0;

  /** Config reference */
  private config: AdventureConfig;

  /** RNG */
  private rng: () => number;

  /** Last direction used for beat extension (for anti-backtracking) */
  private lastBeatDir = 1; // default: east

  /** Torch cells for flickering glow */
  torchCells: Set<string> = new Set();

  /** Every cell the hero has stepped on. Movement is not allowed to revisit these cells. */
  private walkedCellsSet: Set<string> = new Set();
  private readonly debugEnabled = true;

  constructor(seed: number = 42, config?: AdventureConfig) {
    this.config = config || DEFAULT_CONFIG;
    this.width = this.config.mazeWidth;
    this.height = this.config.mazeHeight;
    this.rng = seededRandom(seed);

    // Start hero at center of the grid
    const cx = Math.floor(this.width / 2);
    const cy = Math.floor(this.height / 2);
    this.heroPos = { x: cx, y: cy };
    this.heroTarget = { x: cx, y: cy };
    this.heroLastStart = { x: cx, y: cy };
    this.walkedCellsSet.add(`${cx},${cy}`);

    // Generate initial maze from center (~300 cells for dense visible area)
    this.generateFrom(cx, cy, 300);

    // Place torches at random visited cells
    this.placeTorches(8);

    // Snap camera initially
    this.snapCamera();
    this.debug('Maze:init', {
      width: this.width,
      height: this.height,
      heroPos: this.heroPos,
    });
  }

  private debug(event: string, payload?: Record<string, unknown>): void {
    if (!this.debugEnabled) return;
    const vscode = (window as any).acquireVsCodeApi?.();
    if (vscode) {
      vscode.postMessage({
        type: 'adventureDebugLog',
        source: 'maze',
        event,
        payload,
        ts: Date.now(),
      });
    }
    if (payload) {
      console.debug(`[AdventureDebug][Maze] ${event}`, payload);
      return;
    }
    console.debug(`[AdventureDebug][Maze] ${event}`);
  }

  /** Generate maze from a starting cell using recursive backtracker (iterative stack) */
  generateFrom(startX: number, startY: number, maxCells: number): void {
    const stack: TilePos[] = [{ x: startX, y: startY }];
    this.visited.add(`${startX},${startY}`);
    let count = 0;

    while (stack.length > 0 && count < maxCells) {
      const current = stack[stack.length - 1];
      const neighbors = this.getUnvisitedNeighbors(current.x, current.y);

      if (neighbors.length === 0) {
        stack.pop();
        continue;
      }

      // Pick a random unvisited neighbor
      const [nx, ny, dirIdx] = neighbors[Math.floor(this.rng() * neighbors.length)];

      // Remove wall between current and neighbor
      this.removeWall(current.x, current.y, dirIdx);

      this.visited.add(`${nx},${ny}`);
      stack.push({ x: nx, y: ny });
      count++;
    }
  }

  /** Get unvisited neighbor cells within bounds */
  private getUnvisitedNeighbors(x: number, y: number): [number, number, number][] {
    const result: [number, number, number][] = [];
    for (let i = 0; i < DIRS.length; i++) {
      const [dx, dy] = DIRS[i];
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
        if (!this.visited.has(`${nx},${ny}`)) {
          result.push([nx, ny, i]);
        }
      }
    }
    return result;
  }

  /** Remove wall between cell (x,y) and the neighbor in direction dirIdx */
  private removeWall(x: number, y: number, dirIdx: number): void {
    // We only store E and S walls. N and W are stored as neighbors' S and E.
    switch (dirIdx) {
      case 0: // North: remove south wall of cell above (x, y-1)
        this.passages.add(`${x},${y - 1},S`);
        break;
      case 1: // East: remove east wall of current cell
        this.passages.add(`${x},${y},E`);
        break;
      case 2: // South: remove south wall of current cell
        this.passages.add(`${x},${y},S`);
        break;
      case 3: // West: remove east wall of cell to the left (x-1, y)
        this.passages.add(`${x - 1},${y},E`);
        break;
    }
  }

  /** Check if there is a passage between two adjacent cells */
  hasPassage(x1: number, y1: number, x2: number, y2: number): boolean {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 1 && dy === 0) return this.passages.has(`${x1},${y1},E`);
    if (dx === -1 && dy === 0) return this.passages.has(`${x2},${y2},E`);
    if (dx === 0 && dy === 1) return this.passages.has(`${x1},${y1},S`);
    if (dx === 0 && dy === -1) return this.passages.has(`${x2},${y2},S`);
    return false;
  }

  /** BFS pathfinding from (sx,sy) to (tx,ty) through passages */
  findPath(sx: number, sy: number, tx: number, ty: number): TilePos[] {
    if (sx === tx && sy === ty) return [];

    const queue: TilePos[] = [{ x: sx, y: sy }];
    const came: Map<string, TilePos | null> = new Map();
    came.set(`${sx},${sy}`, null);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.x === tx && current.y === ty) {
        // Reconstruct path
        const path: TilePos[] = [];
        let node: TilePos | null = current;
        while (node) {
          path.unshift(node);
          node = came.get(`${node.x},${node.y}`) ?? null;
        }
        return path.slice(1); // exclude starting position
      }

      for (const [dx, dy] of DIRS) {
        const nx = current.x + dx;
        const ny = current.y + dy;
        const key = `${nx},${ny}`;
        if (!came.has(key) && this.hasPassage(current.x, current.y, nx, ny)) {
          came.set(key, current);
          queue.push({ x: nx, y: ny });
        }
      }
    }

    // No path found - return empty
    return [];
  }

  /** BFS pathfinding that refuses to traverse cells already walked by the hero. */
  findPathAvoidingWalked(sx: number, sy: number, tx: number, ty: number): TilePos[] {
    if (sx === tx && sy === ty) return [];

    const queue: TilePos[] = [{ x: sx, y: sy }];
    const came: Map<string, TilePos | null> = new Map();
    came.set(`${sx},${sy}`, null);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.x === tx && current.y === ty) {
        const path: TilePos[] = [];
        let node: TilePos | null = current;
        while (node) {
          path.unshift(node);
          node = came.get(`${node.x},${node.y}`) ?? null;
        }
        return path.slice(1); // exclude starting position
      }

      for (const [dx, dy] of DIRS) {
        const nx = current.x + dx;
        const ny = current.y + dy;
        const key = `${nx},${ny}`;
        if (came.has(key)) continue;
        if (!this.hasPassage(current.x, current.y, nx, ny)) continue;
        if (this.walkedCellsSet.has(key) && !(nx === tx && ny === ty)) continue;

        came.set(key, current);
        queue.push({ x: nx, y: ny });
      }
    }

    return [];
  }

  /** Get path from hero to target */
  getPathToTarget(): TilePos[] {
    return this.findPath(this.heroPos.x, this.heroPos.y, this.heroTarget.x, this.heroTarget.y);
  }

  /** Get path from hero to target using only fresh (never-walked) cells. */
  getFreshPathToTarget(): TilePos[] {
    return this.findPathAvoidingWalked(this.heroPos.x, this.heroPos.y, this.heroTarget.x, this.heroTarget.y);
  }

  /** Set a short wandering target for ambient movement. */
  setAmbientTarget(active: boolean): void {
    if (active) {
      this.wanderToRandom(3, 5, 9);
      return;
    }
    this.wanderToRandom(2, 3, 5);
  }

  /** Extend the maze in a preferred direction from near the hero, returning the furthest new cell */
  extendMaze(preferredDirIdx: number, cellCount: number): TilePos | null {
    // Find frontier cells (visited cells with unvisited neighbors) near hero
    const frontier = this.getFrontierNear(this.heroPos.x, this.heroPos.y, preferredDirIdx);
    if (frontier.length === 0) return null;

    // Pick a frontier cell (biased toward preferred direction)
    const start = frontier[Math.floor(this.rng() * frontier.length)];

    // Run a small generation from this frontier cell
    const stack: TilePos[] = [start];
    let count = 0;
    const [pdx, pdy] = DIRS[preferredDirIdx];
    const scoreCell = (x: number, y: number): number => {
      const directional = (x - this.heroPos.x) * pdx + (y - this.heroPos.y) * pdy;
      const spread = Math.abs(x - this.heroPos.x) + Math.abs(y - this.heroPos.y);
      return directional * 10 + spread;
    };

    let furthest = start;
    let furthestScore = scoreCell(start.x, start.y);

    while (stack.length > 0 && count < cellCount) {
      const current = stack[stack.length - 1];
      const neighbors = this.getUnvisitedNeighbors(current.x, current.y);

      if (neighbors.length === 0) {
        stack.pop();
        continue;
      }

      // Bias toward preferred direction
      let chosen: [number, number, number];
      const preferred = neighbors.filter(n => n[2] === preferredDirIdx);
      if (preferred.length > 0 && this.rng() < 0.5) {
        chosen = preferred[0];
      } else {
        chosen = neighbors[Math.floor(this.rng() * neighbors.length)];
      }

      const [nx, ny, dirIdx] = chosen;
      this.removeWall(current.x, current.y, dirIdx);
      this.visited.add(`${nx},${ny}`);
      stack.push({ x: nx, y: ny });
      const score = scoreCell(nx, ny);
      if (score > furthestScore) {
        furthest = { x: nx, y: ny };
        furthestScore = score;
      }
      count++;
    }

    // Maybe add a torch in new area
    if (count > 4 && this.rng() > 0.5) {
      this.torchCells.add(`${furthest.x},${furthest.y}`);
    }

    return furthest;
  }

  /** Pick a direction that can actually extend near the hero, with graceful fallback when blocked */
  private chooseExtensionDirection(preferredDirIdx: number): number {
    const candidates = [
      preferredDirIdx,
      (preferredDirIdx + 1) % 4,
      (preferredDirIdx + 3) % 4,
      (preferredDirIdx + 2) % 4,
    ];

    for (const dir of candidates) {
      if (this.hasDirectionalFrontier(dir)) {
        return dir;
      }
    }

    return preferredDirIdx;
  }

  /** True if a visited cell near the hero can extend one step in this direction */
  private hasDirectionalFrontier(dirIdx: number): boolean {
    const [dx, dy] = DIRS[dirIdx];
    const hx = this.heroPos.x;
    const hy = this.heroPos.y;
    const searchRadius = 22;

    for (let oy = -searchRadius; oy <= searchRadius; oy++) {
      for (let ox = -searchRadius; ox <= searchRadius; ox++) {
        const cx = hx + ox;
        const cy = hy + oy;
        if (cx < 0 || cx >= this.width || cy < 0 || cy >= this.height) continue;
        if (!this.visited.has(`${cx},${cy}`)) continue;

        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
        if (!this.visited.has(`${nx},${ny}`)) {
          return true;
        }
      }
    }

    return false;
  }

  /** Score a cell by forward progress relative to the hero in a specific direction */
  private directionalProjection(x: number, y: number, dirIdx: number): number {
    const [pdx, pdy] = DIRS[dirIdx];
    return (x - this.heroPos.x) * pdx + (y - this.heroPos.y) * pdy;
  }

  /** Score a cell by forward progress relative to the hero in a specific direction */
  private scoreDirectionalCell(x: number, y: number, dirIdx: number): number {
    const directional = this.directionalProjection(x, y, dirIdx);
    const spread = Math.abs(x - this.heroPos.x) + Math.abs(y - this.heroPos.y);
    return directional * 14 + spread;
  }

  /** Pick the best newly-carved candidate that advances forward by at least minDistance */
  private chooseDirectionalCandidate(
    dirIdx: number,
    candidates: Array<TilePos | null>,
    minDistance: number,
  ): TilePos | null {
    let best: TilePos | null = null;
    let bestScore = -Infinity;

    for (const c of candidates) {
      if (!c) continue;
      const spread = Math.abs(c.x - this.heroPos.x) + Math.abs(c.y - this.heroPos.y);
      if (spread < minDistance) continue;
      if (this.directionalProjection(c.x, c.y, dirIdx) <= 0) continue;

      const score = this.scoreDirectionalCell(c.x, c.y, dirIdx);
      if (score > bestScore) {
        best = c;
        bestScore = score;
      }
    }

    return best;
  }

  /** Clamp a target so the path to it is long enough to feel meaningful but not excessively long */
  private clampTargetByPath(target: TilePos, minPath: number, maxPath: number): TilePos | null {
    const path = this.findPath(this.heroPos.x, this.heroPos.y, target.x, target.y);
    if (path.length === 0) return null;
    if (path.length > maxPath) return path[maxPath - 1];
    if (path.length < minPath) return null;
    return target;
  }

  /** Pick a long-range reachable target biased toward the preferred direction */
  private chooseForwardTarget(preferredDirIdx: number, minDistance: number): TilePos | null {
    const hx = this.heroPos.x;
    const hy = this.heroPos.y;
    const maxSearchDist = 36;

    const queue: [TilePos, number][] = [[{ x: hx, y: hy }, 0]];
    const seen = new Set<string>([`${hx},${hy}`]);

    let bestDirectional: TilePos | null = null;
    let bestDirectionalScore = -Infinity;

    while (queue.length > 0) {
      const [cell, dist] = queue.shift()!;

      if (dist >= minDistance && !(cell.x === hx && cell.y === hy)) {
        const spread = Math.abs(cell.x - hx) + Math.abs(cell.y - hy);
        const projection = this.directionalProjection(cell.x, cell.y, preferredDirIdx);
        if (projection <= 0) {
          continue;
        }

        const directionalScore = this.scoreDirectionalCell(cell.x, cell.y, preferredDirIdx);
        const longRangePenalty = Math.max(0, spread - 30) * 2;
        const score = directionalScore - longRangePenalty;
        if (score > bestDirectionalScore) {
          bestDirectional = cell;
          bestDirectionalScore = score;
        }
      }

      if (dist >= maxSearchDist) continue;

      for (const [dx, dy] of DIRS) {
        const nx = cell.x + dx;
        const ny = cell.y + dy;
        const key = `${nx},${ny}`;
        if (!seen.has(key) && this.hasPassage(cell.x, cell.y, nx, ny)) {
          seen.add(key);
          queue.push([{ x: nx, y: ny }, dist + 1]);
        }
      }
    }

    return bestDirectional;
  }

  /** Find frontier cells near a position, biased toward a direction */
  private getFrontierNear(hx: number, hy: number, preferredDir: number): TilePos[] {
    const candidates: TilePos[] = [];
    const searchRadius = 22;

    for (let dy = -searchRadius; dy <= searchRadius; dy++) {
      for (let dx = -searchRadius; dx <= searchRadius; dx++) {
        const cx = hx + dx;
        const cy = hy + dy;
        if (cx < 0 || cx >= this.width || cy < 0 || cy >= this.height) continue;
        if (!this.visited.has(`${cx},${cy}`)) continue;

        // Check if this cell has unvisited neighbors
        const unvisited = this.getUnvisitedNeighbors(cx, cy);
        if (unvisited.length > 0) {
          candidates.push({ x: cx, y: cy });
        }
      }
    }

    // Sort by distance in preferred direction
    candidates.sort((a, b) => {
      const scoreA = this.scoreDirectionalCell(a.x, a.y, preferredDir);
      const scoreB = this.scoreDirectionalCell(b.x, b.y, preferredDir);
      return scoreB - scoreA; // Higher score = more in preferred direction
    });

    return candidates.slice(0, 10); // Top candidates in preferred direction
  }

  /** Find a dead-end cell near the hero (for trap/monster beats) */
  findDeadEnd(): TilePos | null {
    const searchRadius = 10;
    const hx = this.heroPos.x;
    const hy = this.heroPos.y;
    const deadEnds: TilePos[] = [];

    for (let dy = -searchRadius; dy <= searchRadius; dy++) {
      for (let dx = -searchRadius; dx <= searchRadius; dx++) {
        const cx = hx + dx;
        const cy = hy + dy;
        if (!this.visited.has(`${cx},${cy}`)) continue;
        if (cx === hx && cy === hy) continue;

        // Count passages from this cell
        let passageCount = 0;
        for (const [ddx, ddy] of DIRS) {
          if (this.hasPassage(cx, cy, cx + ddx, cy + ddy)) passageCount++;
        }
        if (passageCount === 1) {
          deadEnds.push({ x: cx, y: cy });
        }
      }
    }

    if (deadEnds.length === 0) return null;
    return deadEnds[Math.floor(this.rng() * deadEnds.length)];
  }

  /** Remove walls around a cell to create an open area (for treasure/checkpoint) */
  openArea(cx: number, cy: number, radius: number): void {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;
        this.visited.add(`${x},${y}`);

        // Remove walls to neighbors that are also in the area
        if (x + 1 <= cx + radius && x + 1 < this.width) {
          this.passages.add(`${x},${y},E`);
          this.visited.add(`${x + 1},${y}`);
        }
        if (y + 1 <= cy + radius && y + 1 < this.height) {
          this.passages.add(`${x},${y},S`);
          this.visited.add(`${x},${y + 1}`);
        }
      }
    }
  }

  /** Get walkable neighbor cells for patrol */
  getPatrolPath(): TilePos[] {
    const hx = this.heroPos.x;
    const hy = this.heroPos.y;
    const patrol: TilePos[] = [];

    // BFS to find reachable cells within 8 steps (wide patrol range)
    const reachable: TilePos[] = [];
    const seen = new Set<string>();
    const queue: [TilePos, number][] = [[{ x: hx, y: hy }, 0]];
    seen.add(`${hx},${hy}`);

    while (queue.length > 0) {
      const [cell, dist] = queue.shift()!;
      if (dist > 0) reachable.push(cell);
      if (dist >= 8) continue;

      for (const [dx, dy] of DIRS) {
        const nx = cell.x + dx;
        const ny = cell.y + dy;
        const key = `${nx},${ny}`;
        if (!seen.has(key) && this.hasPassage(cell.x, cell.y, nx, ny)) {
          seen.add(key);
          queue.push([{ x: nx, y: ny }, dist + 1]);
        }
      }
    }

    // Pick 4-6 random reachable cells for longer patrols
    const count = Math.min(reachable.length, 4 + Math.floor(this.rng() * 3));
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(this.rng() * reachable.length);
      patrol.push(reachable[idx]);
    }
    // Return to start
    patrol.push({ x: hx, y: hy });
    return patrol;
  }

  /** Place torch markers at random visited cells */
  private placeTorches(count: number): void {
    const cells = Array.from(this.visited);
    for (let i = 0; i < count && cells.length > 0; i++) {
      const idx = Math.floor(this.rng() * cells.length);
      this.torchCells.add(cells[idx]);
    }
  }

  /** Snap camera to hero position instantly */
  snapCamera(): void {
    const { cellSize, canvasWidth, canvasHeight } = this.config;
    this.cameraX = this.heroPos.x * cellSize + cellSize / 2 - canvasWidth / 2;
    this.cameraY = this.heroPos.y * cellSize + cellSize / 2 - canvasHeight / 2;
  }

  /** Smooth-lerp camera toward hero position */
  updateCamera(dt: number): void {
    const { cellSize, canvasWidth, canvasHeight } = this.config;
    const heroCenterX = this.heroPos.x * cellSize + cellSize / 2;
    const heroCenterY = this.heroPos.y * cellSize + cellSize / 2;

    // Look-ahead camera: while moving to a target, bias view forward so travel feels progressive.
    const dx = this.heroTarget.x - this.heroPos.x;
    const dy = this.heroTarget.y - this.heroPos.y;
    const dist = Math.hypot(dx, dy);
    const leadPixels = dist > 2 ? 32 : dist > 0 ? 16 : 0;
    const leadX = dist > 0 ? (dx / dist) * leadPixels : 0;
    const leadY = dist > 0 ? (dy / dist) * leadPixels : 0;

    const targetX = heroCenterX + leadX - canvasWidth / 2;
    const targetY = heroCenterY + leadY - canvasHeight / 2;

    const follow = dist > 0 ? 0.09 : 0.15;
    const lerp = follow * dt * 60;
    this.cameraX += (targetX - this.cameraX) * Math.min(lerp, 1);
    this.cameraY += (targetY - this.cameraY) * Math.min(lerp, 1);
  }

  /** Render the maze onto a canvas context */
  renderMaze(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    frameCount: number,
  ): void {
    const { cellSize, wallThickness } = this.config;
    const camX = this.cameraX;
    const camY = this.cameraY;

    // Determine visible cell range
    const startCellX = Math.floor(camX / cellSize) - 1;
    const startCellY = Math.floor(camY / cellSize) - 1;
    const endCellX = Math.ceil((camX + canvasWidth) / cellSize) + 1;
    const endCellY = Math.ceil((camY + canvasHeight) / cellSize) + 1;

    // Draw floor for visited cells
    const floorColor1 = PALETTE[16]; // dark gray
    const floorColor2 = '#2a3045';   // slightly lighter
    for (let cy = startCellY; cy <= endCellY; cy++) {
      for (let cx = startCellX; cx <= endCellX; cx++) {
        if (cx < 0 || cx >= this.width || cy < 0 || cy >= this.height) continue;
        if (!this.visited.has(`${cx},${cy}`)) continue;

        const screenX = cx * cellSize - camX;
        const screenY = cy * cellSize - camY;

        // Alternating floor shade
        ctx.fillStyle = (cx + cy) % 3 === 0 ? floorColor2 : floorColor1;
        ctx.fillRect(screenX, screenY, cellSize, cellSize);
      }
    }

    // Draw walls (2px lines on cell edges where no passage exists)
    ctx.fillStyle = PALETTE[9]; // dark blue walls
    for (let cy = startCellY; cy <= endCellY; cy++) {
      for (let cx = startCellX; cx <= endCellX; cx++) {
        if (cx < 0 || cx >= this.width || cy < 0 || cy >= this.height) continue;
        if (!this.visited.has(`${cx},${cy}`)) continue;

        const screenX = cx * cellSize - camX;
        const screenY = cy * cellSize - camY;

        // East wall (right edge of cell)
        if (!this.passages.has(`${cx},${cy},E`)) {
          // Draw wall if the east neighbor is also visited (otherwise it's outer boundary)
          const eastVisited = this.visited.has(`${cx + 1},${cy}`);
          if (eastVisited || cx === this.width - 1) {
            ctx.fillRect(screenX + cellSize - wallThickness, screenY, wallThickness, cellSize);
          }
        }

        // South wall (bottom edge of cell)
        if (!this.passages.has(`${cx},${cy},S`)) {
          const southVisited = this.visited.has(`${cx},${cy + 1}`);
          if (southVisited || cy === this.height - 1) {
            ctx.fillRect(screenX, screenY + cellSize - wallThickness, cellSize, wallThickness);
          }
        }

        // West boundary wall (left edge)
        if (cx === 0 || !this.visited.has(`${cx - 1},${cy}`)) {
          ctx.fillRect(screenX, screenY, wallThickness, cellSize);
        } else if (!this.passages.has(`${cx - 1},${cy},E`)) {
          // Wall between this cell and the west neighbor
          // Already handled by the west neighbor's east wall
        }

        // North boundary wall (top edge)
        if (cy === 0 || !this.visited.has(`${cx},${cy - 1}`)) {
          ctx.fillRect(screenX, screenY, cellSize, wallThickness);
        }
      }
    }

    // Draw torch glow effects
    for (const key of this.torchCells) {
      const parts = key.split(',');
      const tx = parseInt(parts[0]);
      const ty = parseInt(parts[1]);
      if (tx < startCellX || tx > endCellX || ty < startCellY || ty > endCellY) continue;

      const screenX = tx * cellSize - camX + cellSize / 2;
      const screenY = ty * cellSize - camY + cellSize / 2;

      // Flickering warm glow
      const glowRadius = 10 + Math.sin(frameCount * 0.3 + tx * 7) * 3;
      const alpha = 0.1 + Math.sin(frameCount * 0.2 + ty * 5) * 0.04;
      ctx.fillStyle = `rgba(239, 125, 87, ${alpha})`;
      ctx.beginPath();
      ctx.arc(screenX, screenY, glowRadius, 0, Math.PI * 2);
      ctx.fill();

      // Torch pip (small orange dot)
      ctx.fillStyle = PALETTE[4]; // orange
      ctx.fillRect(screenX - 1, screenY - 1, 2, 2);
    }
  }

  /** Process a beat: extend maze and set hero target */
  addBeat(beat: AdventureBeat): void {
    switch (beat.beat) {
      case 'scout':
      case 'read': {
        const dir = this.chooseExtensionDirection(1); // Prefer East
        this.setStrictTarget(dir, 24, 72, 48, 20);
        break;
      }
      case 'carve':
      case 'forge': {
        const dir = this.chooseExtensionDirection(2); // Prefer South
        this.setStrictTarget(dir, 24, 72, 50, 24);
        break;
      }
      case 'fork': {
        // Create junction: extend in 3 directions - 5-10 cells each
        for (let i = 0; i < 3; i++) {
          const dir = (this.lastBeatDir + i + 1) % 4;
          this.extendMaze(dir, 5 + Math.floor(this.rng() * 6));
        }
        const dir = this.chooseExtensionDirection((this.lastBeatDir + 1 + Math.floor(this.rng() * 3)) % 4);
        this.setStrictTarget(dir, 20, 60, 42, 16);
        break;
      }
      case 'trap':
      case 'monster':
      case 'boss': {
        const dir = this.chooseExtensionDirection(this.lastBeatDir);
        this.setStrictTarget(dir, 18, 52, 40, 16);
        break;
      }
      case 'treasure': {
        this.openArea(this.heroPos.x, this.heroPos.y, 2);
        const dir = this.chooseExtensionDirection(this.lastBeatDir);
        this.setStrictTarget(dir, 20, 60, 44, 18);
        break;
      }
      case 'checkpoint': {
        this.openArea(this.heroPos.x, this.heroPos.y, 1);
        const dir = this.chooseExtensionDirection(this.lastBeatDir);
        this.setStrictTarget(dir, 18, 56, 40, 16);
        break;
      }
      case 'wander':
      default: {
        const dir = this.chooseExtensionDirection(this.lastBeatDir);
        this.setStrictTarget(dir, 18, 56, 40, 16);
        break;
      }
    }
  }

  /** Hard target assignment: if no fresh path exists right now, stay in place (never revisit). */
  private setStrictTarget(
    preferredDir: number,
    minSteps: number,
    maxSteps: number,
    carveBase: number,
    carveJitter: number,
  ): void {
    const target = this.chooseStrictFreshTarget(preferredDir, minSteps, maxSteps, carveBase, carveJitter);
    if (!target) {
      this.debug('setStrictTarget:noTarget', {
        preferredDir,
        minSteps,
        maxSteps,
        heroPos: this.heroPos,
      });
      this.heroTarget = { ...this.heroPos };
      return;
    }

    this.heroTarget = target;
    this.debug('setStrictTarget:target', {
      preferredDir,
      heroPos: this.heroPos,
      heroTarget: this.heroTarget,
      minSteps,
      maxSteps,
    });
    this.updateLastBeatDirFromTarget(target);
  }

  /** Finds a target reachable without stepping on any walked cell. */
  private chooseStrictFreshTarget(
    preferredDir: number,
    minSteps: number,
    maxSteps: number,
    carveBase: number,
    carveJitter: number,
  ): TilePos | null {
    let target =
      this.chooseFreshTarget(minSteps, maxSteps, true) ??
      this.chooseFreshTarget(1, Math.max(maxSteps, 24), true) ??
      this.chooseFreshTarget(minSteps, maxSteps) ??
      this.chooseFreshTarget(1, Math.max(maxSteps, 24));
    if (target) {
      this.debug('chooseStrictFreshTarget:existingFresh', {
        target,
        minSteps,
        maxSteps,
      });
      return target;
    }

    const followupMin = Math.max(8, minSteps - 10);
    const followupMax = maxSteps + 20;
    for (let i = 0; i < 4; i++) {
      const dir = (preferredDir + i) % 4;
      const carveLen = carveBase + Math.floor(this.rng() * (Math.max(0, carveJitter) + 1));
      const freshEnd = this.carveFromPos(this.heroPos.x, this.heroPos.y, dir, carveLen);
      if (!freshEnd) continue;

      target =
        this.chooseFreshTarget(followupMin, followupMax, true) ??
        this.chooseFreshTarget(1, followupMax, true) ??
        this.chooseFreshTarget(followupMin, followupMax) ??
        this.chooseFreshTarget(1, followupMax);
      if (target) {
        this.debug('chooseStrictFreshTarget:carveAndTarget', {
          dir,
          carveLen,
          target,
          followupMin,
          followupMax,
        });
        return target;
      }
      this.debug('chooseStrictFreshTarget:carveFallbackEnd', {
        dir,
        carveLen,
        freshEnd,
      });
      return freshEnd;
    }

    this.debug('chooseStrictFreshTarget:relocateChunk', {
      preferredDir,
      minSteps,
      maxSteps,
    });
    return this.relocateToFreshChunk(preferredDir, minSteps, maxSteps, carveBase, carveJitter);
  }

  /** Ensure world bounds are large enough for dynamic chunk expansion. */
  private ensureWorldSize(minWidth: number, minHeight: number): void {
    const prevW = this.width;
    const prevH = this.height;
    if (minWidth > this.width) this.width = minWidth;
    if (minHeight > this.height) this.height = minHeight;
    if (this.width !== prevW || this.height !== prevH) {
      this.debug('ensureWorldSize:grow', {
        from: { width: prevW, height: prevH },
        to: { width: this.width, height: this.height },
      });
    }
  }

  /** Infinite-mode fallback: relocate hero to a brand-new chunk and continue on fresh cells only. */
  private relocateToFreshChunk(
    preferredDir: number,
    minSteps: number,
    maxSteps: number,
    carveBase: number,
    carveJitter: number,
  ): TilePos | null {
    const chunkPadding = 60;
    const chunkSpan = Math.max(180, carveBase + maxSteps + 80);
    const anchorX = this.width + chunkPadding;
    const anchorY = Math.max(20, Math.min(this.height - 21, this.heroPos.y));

    this.ensureWorldSize(anchorX + chunkSpan, anchorY + chunkPadding + chunkSpan);

    this.heroPos = { x: anchorX, y: anchorY };
    this.heroTarget = { x: anchorX, y: anchorY };

    this.visited.add(`${anchorX},${anchorY}`);
    this.walkedCellsSet.add(`${anchorX},${anchorY}`);
    this.debug('relocateToFreshChunk:anchor', {
      from: { x: this.heroLastStart.x, y: this.heroLastStart.y },
      anchor: { x: anchorX, y: anchorY },
      world: { width: this.width, height: this.height },
      preferredDir,
      minSteps,
      maxSteps,
    });

    let fallback: TilePos | null = null;
    for (let i = 0; i < 4; i++) {
      const dir = (preferredDir + i) % 4;
      const carveLen = carveBase + Math.floor(this.rng() * (Math.max(0, carveJitter) + 1)) + maxSteps;
      const freshEnd = this.carveFromPos(anchorX, anchorY, dir, carveLen);
      if (!freshEnd) continue;

      fallback = freshEnd;
      const target =
        this.chooseFreshTarget(minSteps, maxSteps, true) ??
        this.chooseFreshTarget(1, maxSteps + 40, true) ??
        this.chooseFreshTarget(1, maxSteps + 40);
      if (target) {
        this.debug('relocateToFreshChunk:targetFound', {
          dir,
          carveLen,
          target,
        });
        return target;
      }
    }

    this.debug('relocateToFreshChunk:fallback', { fallback });
    return fallback;
  }

  /** Update lastBeatDir so the next beat keeps momentum in the current travel direction. */
  private updateLastBeatDirFromTarget(target: TilePos): void {
    const dx = target.x - this.heroPos.x;
    const dy = target.y - this.heroPos.y;
    if (dx === 0 && dy === 0) return;

    if (Math.abs(dx) >= Math.abs(dy)) {
      this.lastBeatDir = dx >= 0 ? 1 : 3;
      return;
    }

    this.lastBeatDir = dy >= 0 ? 2 : 0;
  }

  /** Called by AdventureEngine after each walk completes - records every walked cell forever. */
  markCellsWalked(cells: TilePos[]): void {
    for (const c of cells) {
      this.walkedCellsSet.add(`${c.x},${c.y}`);
    }
    this.walkedCellsSet.add(`${this.heroPos.x},${this.heroPos.y}`);
  }

  /** True if the hero has stepped on this cell at any point in the session. */
  hasWalkedCell(x: number, y: number): boolean {
    return this.walkedCellsSet.has(`${x},${y}`);
  }
  /** Pick a reachable target that is between minSteps and maxSteps BFS steps from the hero.
   *  Biases toward candidates that continue the hero's current direction of travel so there
   *  is no visible backtracking between consecutive beats. */
  private chooseFarTarget(minSteps: number, maxSteps: number): TilePos | null {
    const hx = this.heroPos.x;
    const hy = this.heroPos.y;
    const candidates: TilePos[] = [];
    const seen = new Set<string>([`${hx},${hy}`]);
    const queue: [TilePos, number][] = [[{ x: hx, y: hy }, 0]];

    while (queue.length > 0) {
      const [cell, dist] = queue.shift()!;
      if (dist >= minSteps) {
        candidates.push(cell);
      }
      if (dist >= maxSteps) continue;

      for (const [dx, dy] of DIRS) {
        const nx = cell.x + dx;
        const ny = cell.y + dy;
        const key = `${nx},${ny}`;
        if (!seen.has(key) && this.hasPassage(cell.x, cell.y, nx, ny)) {
          seen.add(key);
          queue.push([{ x: nx, y: ny }, dist + 1]);
        }
      }
    }

    if (candidates.length === 0) return null;

    // Forward vector: direction the hero has been moving (prev walk start → current pos).
    const fwdX = hx - this.heroLastStart.x;
    const fwdY = hy - this.heroLastStart.y;
    const hasFwd = fwdX !== 0 || fwdY !== 0;

    const isFresh   = (c: TilePos) => !this.walkedCellsSet.has(`${c.x},${c.y}`);
    const isForward = (c: TilePos) => !hasFwd || (c.x - hx) * fwdX + (c.y - hy) * fwdY > 0;

    const pickFar = (pool: TilePos[]) => {
      const farStart = Math.floor(pool.length * 0.4);
      return pool[farStart + Math.floor(this.rng() * (pool.length - farStart))];
    };

    // Priority 1 — fresh cells that also continue forward (ideal: no backtrack, no revisit)
    const p1 = candidates.filter(c => isFresh(c) && isForward(c));
    if (p1.length > 0) return pickFar(p1);

    // Priority 2 — any fresh cell (forward filter failed, but at least avoid revisiting)
    const p2 = candidates.filter(isFresh);
    if (p2.length > 0) return pickFar(p2);

    // Priority 3 — hero has walked everything; at least keep going forward
    const p3 = candidates.filter(isForward);
    if (p3.length > 0) return pickFar(p3);

    // Priority 4 — full fallback: any cell at the required distance
    return pickFar(candidates);
  }

  /** BFS from heroPos traversing ONLY cells not in walkedCellsSet.
   *  The entire path to the returned target will be through fresh (unwalked) corridors. */
  private chooseFreshTarget(minSteps: number, maxSteps: number, requireFrontier = false): TilePos | null {
    const hx = this.heroPos.x;
    const hy = this.heroPos.y;
    const candidates: TilePos[] = [];
    const seen = new Set<string>([`${hx},${hy}`]);
    const queue: [TilePos, number][] = [[{ x: hx, y: hy }, 0]];

    while (queue.length > 0) {
      const [cell, dist] = queue.shift()!;
      if (dist >= minSteps) candidates.push(cell);
      if (dist >= maxSteps) continue;

      for (const [dx, dy] of DIRS) {
        const nx = cell.x + dx;
        const ny = cell.y + dy;
        const key = `${nx},${ny}`;
        // Only traverse through cells the hero has NOT walked yet
        if (!seen.has(key) && this.hasPassage(cell.x, cell.y, nx, ny) && !this.walkedCellsSet.has(key)) {
          seen.add(key);
          queue.push([{ x: nx, y: ny }, dist + 1]);
        }
      }
    }

    if (candidates.length === 0) return null;

    // Prefer frontier cells (with at least one unvisited neighbor) to reduce deadlocks.
    const frontierCandidates = candidates.filter(c => this.getUnvisitedNeighbors(c.x, c.y).length > 0);
    if (requireFrontier && frontierCandidates.length === 0) return null;
    const pool = frontierCandidates.length > 0 ? frontierCandidates : candidates;

    const farStart = Math.floor(pool.length * 0.4);
    return pool[farStart + Math.floor(this.rng() * (pool.length - farStart))];
  }

  /** Carve a fresh corridor of up to cellCount cells starting from (x, y) directly into
   *  unvisited (outside-the-maze) territory in the preferred direction.
   *  Returns the furthest newly-carved cell, or null if (x,y) is surrounded by existing cells. */
  private carveFromPos(x: number, y: number, preferredDir: number, cellCount: number): TilePos | null {
    // Try preferred direction first, then others
    for (let d = 0; d < 4; d++) {
      const dir = (preferredDir + d) % 4;
      const [dx, dy] = DIRS[dir];
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
      if (this.visited.has(`${nx},${ny}`)) continue; // already in maze

      // Open the wall between (x,y) and the first fresh cell
      this.removeWall(x, y, dir);
      this.visited.add(`${nx},${ny}`);

      // DFS-carve onward from the fresh cell
      const stack: TilePos[] = [{ x: nx, y: ny }];
      let count = 1;
      let furthest = { x: nx, y: ny };

      while (stack.length > 0 && count < cellCount) {
        const current = stack[stack.length - 1];
        const neighbors = this.getUnvisitedNeighbors(current.x, current.y);
        if (neighbors.length === 0) { stack.pop(); continue; }

        // Bias toward the preferred direction for a straighter corridor
        const prefN = neighbors.filter(n => n[2] === dir);
        const chosen = (prefN.length > 0 && this.rng() < 0.65)
          ? prefN[0]
          : neighbors[Math.floor(this.rng() * neighbors.length)];

        const [cnx, cny, cdirIdx] = chosen;
        this.removeWall(current.x, current.y, cdirIdx);
        this.visited.add(`${cnx},${cny}`);
        stack.push({ x: cnx, y: cny });
        furthest = { x: cnx, y: cny };
        count++;
      }

      if (count > 3 && this.rng() > 0.5) {
        this.torchCells.add(`${furthest.x},${furthest.y}`);
      }
      return furthest;
    }
    return null; // heroPos is surrounded by already-visited cells
  }

  /** Set hero target to a random reachable cell nearby */
  private wanderToRandom(minDist = 4, maxDistMin = 6, maxDistMax = 12): void {
    const reachable: TilePos[] = [];
    const seen = new Set<string>();
    const queue: [TilePos, number][] = [[{ x: this.heroPos.x, y: this.heroPos.y }, 0]];
    seen.add(`${this.heroPos.x},${this.heroPos.y}`);
    const maxDist = maxDistMin + Math.floor(this.rng() * (Math.max(maxDistMax - maxDistMin, 0) + 1));

    while (queue.length > 0) {
      const [cell, dist] = queue.shift()!;
      if (dist >= minDist) reachable.push(cell); // configurable min distance
      if (dist >= maxDist) continue;

      for (const [dx, dy] of DIRS) {
        const nx = cell.x + dx;
        const ny = cell.y + dy;
        const key = `${nx},${ny}`;
        if (!seen.has(key) && this.hasPassage(cell.x, cell.y, nx, ny)) {
          seen.add(key);
          queue.push([{ x: nx, y: ny }, dist + 1]);
        }
      }
    }

    if (reachable.length > 0) {
      this.heroTarget = reachable[Math.floor(this.rng() * reachable.length)];
    }
  }
}
