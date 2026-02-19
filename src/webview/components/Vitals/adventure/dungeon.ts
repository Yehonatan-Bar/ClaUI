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

    // Generate initial maze from center (~300 cells for dense visible area)
    this.generateFrom(cx, cy, 300);

    // Place torches at random visited cells
    this.placeTorches(8);

    // Snap camera initially
    this.snapCamera();
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

  /** Get path from hero to target */
  getPathToTarget(): TilePos[] {
    return this.findPath(this.heroPos.x, this.heroPos.y, this.heroTarget.x, this.heroTarget.y);
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
    let furthest = start;

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
      furthest = { x: nx, y: ny };
      count++;
    }

    // Maybe add a torch in new area
    if (count > 4 && this.rng() > 0.5) {
      this.torchCells.add(`${furthest.x},${furthest.y}`);
    }

    return furthest;
  }

  /** Find frontier cells near a position, biased toward a direction */
  private getFrontierNear(hx: number, hy: number, preferredDir: number): TilePos[] {
    const candidates: TilePos[] = [];
    const searchRadius = 8;

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
    const [pdx, pdy] = DIRS[preferredDir];
    candidates.sort((a, b) => {
      const scoreA = (a.x - hx) * pdx + (a.y - hy) * pdy;
      const scoreB = (b.x - hx) * pdx + (b.y - hy) * pdy;
      return scoreB - scoreA; // Higher score = more in preferred direction
    });

    return candidates.slice(0, 5); // Top 5 candidates
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
    const targetX = this.heroPos.x * cellSize + cellSize / 2 - canvasWidth / 2;
    const targetY = this.heroPos.y * cellSize + cellSize / 2 - canvasHeight / 2;

    const lerp = 0.08 * dt * 60;
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
        // Extend maze to the right (exploring) - 10-20 cells
        const count = 10 + Math.floor(this.rng() * 11);
        const target = this.extendMaze(1, count); // East
        if (target) {
          this.heroTarget = target;
        } else {
          this.wanderToRandom();
        }
        this.lastBeatDir = 1;
        break;
      }
      case 'carve':
      case 'forge': {
        // Extend maze downward (digging deeper) - 10-20 cells
        const count = 10 + Math.floor(this.rng() * 11);
        const target = this.extendMaze(2, count); // South
        if (target) {
          this.heroTarget = target;
        } else {
          this.wanderToRandom();
        }
        this.lastBeatDir = 2;
        break;
      }
      case 'fork': {
        // Create junction: extend in 3 directions - 5-10 cells each
        for (let i = 0; i < 3; i++) {
          const dir = (this.lastBeatDir + i + 1) % 4;
          this.extendMaze(dir, 5 + Math.floor(this.rng() * 6));
        }
        this.wanderToRandom();
        break;
      }
      case 'trap':
      case 'monster':
      case 'boss': {
        // Walk to a dead end
        const deadEnd = this.findDeadEnd();
        if (deadEnd) {
          this.heroTarget = deadEnd;
        } else {
          this.wanderToRandom();
        }
        break;
      }
      case 'treasure': {
        // Open area around hero (radius 2 = 5x5 open space)
        this.openArea(this.heroPos.x, this.heroPos.y, 2);
        this.wanderToRandom();
        break;
      }
      case 'checkpoint': {
        // Cleared space (radius 1 = 3x3)
        this.openArea(this.heroPos.x, this.heroPos.y, 1);
        this.wanderToRandom(); // Walk away from cleared spot
        break;
      }
      case 'wander':
      default: {
        // Meander through existing maze
        this.wanderToRandom();
        break;
      }
    }
  }

  /** Set hero target to a random reachable cell nearby */
  private wanderToRandom(): void {
    const reachable: TilePos[] = [];
    const seen = new Set<string>();
    const queue: [TilePos, number][] = [[{ x: this.heroPos.x, y: this.heroPos.y }, 0]];
    seen.add(`${this.heroPos.x},${this.heroPos.y}`);
    const maxDist = 6 + Math.floor(this.rng() * 6); // 6-12 cells away

    while (queue.length > 0) {
      const [cell, dist] = queue.shift()!;
      if (dist >= 4) reachable.push(cell); // min 4 cells away
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
