/**
 * Dungeon map generation and camera system.
 * Generates rooms connected by corridors as the session progresses.
 * The camera follows the hero with the hero always centered.
 */

import type { AdventureBeat, TilePos, DungeonRoom, RoomType } from './types';
import { getRoomTemplate, ROOM_SIZE, CORRIDOR_LENGTH } from './rooms';
import { WALL, FLOOR_1, FLOOR_2, TORCH_1, TORCH_2, DOOR_OPEN, drawSprite } from './sprites';
import type { SpriteFrame } from './types';

/** Tile types stored in the map */
export const TILE = {
  VOID: 0,
  FLOOR: 1,
  WALL: 2,
  TORCH: 3,
  DOOR: 4,
  ENCOUNTER: 5,
} as const;

/** Directions for room connections */
const DIRECTIONS: TilePos[] = [
  { x: 0, y: -1 },  // up
  { x: 1, y: 0 },   // right
  { x: 0, y: 1 },   // down
  { x: -1, y: 0 },  // left
];

/** Simple seeded random for deterministic generation */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

export class Dungeon {
  /** All rooms in the dungeon */
  rooms: DungeonRoom[] = [];

  /** Tile data: key = "x,y", value = tile type */
  private tiles: Map<string, number> = new Map();

  /** Current hero position (tile coords) */
  heroPos: TilePos = { x: 0, y: 0 };

  /** Target hero position (for animation) */
  heroTarget: TilePos = { x: 0, y: 0 };

  /** Camera offset in pixels (top-left of viewport in world space) */
  cameraX = 0;
  cameraY = 0;

  /** Random number generator */
  private rng: () => number;

  /** Next direction index for room placement (cycles to create maze-like paths) */
  private nextDirIdx = 0;

  constructor(seed: number = 42) {
    this.rng = seededRandom(seed);
    // Create the starting room (corridor)
    this.addRoom('corridor', null);
    const startRoom = this.rooms[0];
    this.heroPos = { ...startRoom.center };
    this.heroTarget = { ...startRoom.center };
  }

  /** Add a new room connected to the last room */
  addRoom(type: RoomType, beat: AdventureBeat | null): DungeonRoom {
    const template = getRoomTemplate(type);
    let pos: TilePos;

    if (this.rooms.length === 0) {
      // First room at origin
      pos = { x: 0, y: 0 };
    } else {
      // Connect to the last room
      const lastRoom = this.rooms[this.rooms.length - 1];
      const dir = this.pickDirection();
      const offset = DIRECTIONS[dir];

      // Place the new room with a corridor gap
      const totalOffset = ROOM_SIZE + CORRIDOR_LENGTH;
      pos = {
        x: lastRoom.pos.x + offset.x * totalOffset,
        y: lastRoom.pos.y + offset.y * totalOffset,
      };

      // Generate corridor tiles between the rooms
      this.generateCorridor(lastRoom, pos, dir);

      // Record connection
      lastRoom.connections.push(this.rooms.length);
    }

    const room: DungeonRoom = {
      pos,
      width: ROOM_SIZE,
      height: ROOM_SIZE,
      type,
      beat,
      connections: [],
      center: {
        x: pos.x + Math.floor(ROOM_SIZE / 2),
        y: pos.y + Math.floor(ROOM_SIZE / 2),
      },
    };

    // Write room tiles to the map
    for (let dy = 0; dy < ROOM_SIZE; dy++) {
      for (let dx = 0; dx < ROOM_SIZE; dx++) {
        const tileType = template[dy][dx];
        if (tileType !== 0) {
          this.setTile(pos.x + dx, pos.y + dy, tileType);
        }
      }
    }

    // Fill walls around the room
    this.fillWallsAround(pos, ROOM_SIZE, ROOM_SIZE);

    this.rooms.push(room);
    return room;
  }

  /** Add a beat as a new room and set the hero target */
  addBeat(beat: AdventureBeat): DungeonRoom {
    const room = this.addRoom(beat.roomType, beat);
    this.heroTarget = { ...room.center };
    return room;
  }

  /** Get a tile value at coordinates */
  getTile(x: number, y: number): number {
    return this.tiles.get(`${x},${y}`) ?? TILE.VOID;
  }

  /** Set a tile value */
  private setTile(x: number, y: number, value: number): void {
    this.tiles.set(`${x},${y}`, value);
  }

  /** Generate L-shaped corridor tiles between two rooms for maze-like feel */
  private generateCorridor(from: DungeonRoom, toPos: TilePos, dirIdx: number): void {
    const toCenter = {
      x: toPos.x + Math.floor(ROOM_SIZE / 2),
      y: toPos.y + Math.floor(ROOM_SIZE / 2),
    };

    const cx = from.center.x;
    const cy = from.center.y;
    const tx = toCenter.x;
    const ty = toCenter.y;

    // Decide bend point: randomly along the corridor with some variation
    const bendFraction = 0.3 + this.rng() * 0.4; // 30-70% along the way

    // Build the corridor as a set of waypoints (L-shaped or Z-shaped)
    const waypoints: TilePos[] = [{ x: cx, y: cy }];

    const isHorizontalFirst = (dirIdx === 1 || dirIdx === 3); // right or left

    if (isHorizontalFirst) {
      // Go horizontal, then bend vertical
      const bendX = Math.round(cx + (tx - cx) * bendFraction);
      waypoints.push({ x: bendX, y: cy });
      waypoints.push({ x: bendX, y: ty });
      waypoints.push({ x: tx, y: ty });
    } else {
      // Go vertical, then bend horizontal
      const bendY = Math.round(cy + (ty - cy) * bendFraction);
      waypoints.push({ x: cx, y: bendY });
      waypoints.push({ x: tx, y: bendY });
      waypoints.push({ x: tx, y: ty });
    }

    // Walk each segment and carve corridor tiles
    for (let w = 0; w < waypoints.length - 1; w++) {
      const a = waypoints[w];
      const b = waypoints[w + 1];
      this.carveCorridorSegment(a, b, toPos);
    }
  }

  /** Carve a straight corridor segment from A to B, with walls on sides */
  private carveCorridorSegment(a: TilePos, b: TilePos, roomPos: TilePos): void {
    let cx = a.x;
    let cy = a.y;
    const dx = Math.sign(b.x - a.x);
    const dy = Math.sign(b.y - a.y);
    const maxSteps = Math.abs(b.x - a.x) + Math.abs(b.y - a.y) + 1;

    for (let i = 0; i < maxSteps; i++) {
      // Skip if we're inside a room area
      if (cx >= roomPos.x && cx < roomPos.x + ROOM_SIZE &&
          cy >= roomPos.y && cy < roomPos.y + ROOM_SIZE) {
        cx += dx;
        cy += dy;
        continue;
      }

      this.setTile(cx, cy, TILE.FLOOR);

      // Add walls on the sides based on movement direction
      if (dx !== 0) {
        // Horizontal - walls above and below
        if (this.getTile(cx, cy - 1) === TILE.VOID) this.setTile(cx, cy - 1, TILE.WALL);
        if (this.getTile(cx, cy + 1) === TILE.VOID) this.setTile(cx, cy + 1, TILE.WALL);
      }
      if (dy !== 0) {
        // Vertical - walls left and right
        if (this.getTile(cx - 1, cy) === TILE.VOID) this.setTile(cx - 1, cy, TILE.WALL);
        if (this.getTile(cx + 1, cy) === TILE.VOID) this.setTile(cx + 1, cy, TILE.WALL);
      }
      // At bend corners, add walls all around
      if (dx === 0 && dy === 0) {
        for (const d of DIRECTIONS) {
          if (this.getTile(cx + d.x, cy + d.y) === TILE.VOID) {
            this.setTile(cx + d.x, cy + d.y, TILE.WALL);
          }
        }
      }

      cx += dx;
      cy += dy;
    }
  }

  /** Fill walls around a room where void tiles exist */
  private fillWallsAround(pos: TilePos, w: number, h: number): void {
    for (let dy = -1; dy <= h; dy++) {
      for (let dx = -1; dx <= w; dx++) {
        const tx = pos.x + dx;
        const ty = pos.y + dy;
        if (this.getTile(tx, ty) === TILE.VOID) {
          // Check if adjacent to any non-void, non-wall tile
          const adjacent = [
            this.getTile(tx - 1, ty),
            this.getTile(tx + 1, ty),
            this.getTile(tx, ty - 1),
            this.getTile(tx, ty + 1),
          ];
          if (adjacent.some(t => t !== TILE.VOID && t !== TILE.WALL)) {
            this.setTile(tx, ty, TILE.WALL);
          }
        }
      }
    }
  }

  /** Pick a direction for the next room - avoids going back the way we came */
  private pickDirection(): number {
    // More balanced weights - still slight forward bias but all directions possible
    const baseWeights = [0.2, 0.3, 0.3, 0.2]; // up, right, down, left

    // Penalize the reverse of the last direction to avoid backtracking
    const reverseDir = (this.nextDirIdx + 2) % 4;
    const weights = baseWeights.map((w, i) => i === reverseDir ? w * 0.2 : w);

    // Normalize weights
    const total = weights.reduce((a, b) => a + b, 0);
    const r = this.rng() * total;
    let cumulative = 0;
    for (let i = 0; i < weights.length; i++) {
      cumulative += weights[i];
      if (r < cumulative) {
        this.nextDirIdx = i;
        return i;
      }
    }
    return 1; // default right
  }

  /** Update camera to center on hero position */
  updateCamera(viewportWidth: number, viewportHeight: number, pixelScale: number, tileSize: number): void {
    const tilePx = tileSize * pixelScale;
    this.cameraX = this.heroPos.x * tilePx - viewportWidth / 2 + tilePx / 2;
    this.cameraY = this.heroPos.y * tilePx - viewportHeight / 2 + tilePx / 2;
  }

  /** Render visible tiles onto a canvas */
  renderTiles(
    ctx: CanvasRenderingContext2D,
    viewportWidth: number,
    viewportHeight: number,
    pixelScale: number,
    tileSize: number,
    frameCount: number,
  ): void {
    const tilePx = tileSize * pixelScale;
    const startTileX = Math.floor(this.cameraX / tilePx) - 1;
    const startTileY = Math.floor(this.cameraY / tilePx) - 1;
    const endTileX = startTileX + Math.ceil(viewportWidth / tilePx) + 2;
    const endTileY = startTileY + Math.ceil(viewportHeight / tilePx) + 2;

    for (let ty = startTileY; ty <= endTileY; ty++) {
      for (let tx = startTileX; tx <= endTileX; tx++) {
        const tileType = this.getTile(tx, ty);
        const screenX = tx * tilePx - this.cameraX;
        const screenY = ty * tilePx - this.cameraY;

        let sprite: SpriteFrame | null = null;
        switch (tileType) {
          case TILE.VOID:
            // Draw nothing (black background)
            continue;
          case TILE.FLOOR:
          case TILE.ENCOUNTER:
          case TILE.DOOR:
            // Use alternating floor variants based on position
            sprite = ((tx + ty) % 3 === 0) ? FLOOR_2 : FLOOR_1;
            break;
          case TILE.WALL:
            sprite = WALL;
            break;
          case TILE.TORCH: {
            // Floor underneath
            sprite = FLOOR_1;
            drawSprite(ctx, sprite, screenX, screenY, pixelScale);
            // Torch on top (animated)
            const torchFrame = Math.floor(frameCount / 15) % 2 === 0 ? TORCH_1 : TORCH_2;
            drawSprite(ctx, torchFrame, screenX, screenY, pixelScale);
            continue; // Already drew floor + torch
          }
        }

        if (sprite) {
          drawSprite(ctx, sprite, screenX, screenY, pixelScale);
        }

        // Draw door overlay on door tiles
        if (tileType === TILE.DOOR) {
          drawSprite(ctx, DOOR_OPEN, screenX, screenY, pixelScale);
        }
      }
    }
  }

  /** Get the path from current hero position to target (zigzag for movement variety) */
  getPathToTarget(): TilePos[] {
    const path: TilePos[] = [];
    let cx = this.heroPos.x;
    let cy = this.heroPos.y;
    const tx = this.heroTarget.x;
    const ty = this.heroTarget.y;

    // Zigzag: alternate horizontal and vertical steps for visible multi-directional movement
    let moveX = true; // start with horizontal
    while (cx !== tx || cy !== ty) {
      const remainX = Math.abs(tx - cx);
      const remainY = Math.abs(ty - cy);

      if (remainX === 0) {
        // Only vertical left
        cy += cy < ty ? 1 : -1;
      } else if (remainY === 0) {
        // Only horizontal left
        cx += cx < tx ? 1 : -1;
      } else if (moveX) {
        // Take 1-2 horizontal steps
        const steps = Math.min(remainX, 1 + Math.floor(this.rng() * 2));
        for (let i = 0; i < steps && cx !== tx; i++) {
          cx += cx < tx ? 1 : -1;
          path.push({ x: cx, y: cy });
        }
        moveX = false;
        continue; // already pushed
      } else {
        // Take 1-2 vertical steps
        const steps = Math.min(remainY, 1 + Math.floor(this.rng() * 2));
        for (let i = 0; i < steps && cy !== ty; i++) {
          cy += cy < ty ? 1 : -1;
          path.push({ x: cx, y: cy });
        }
        moveX = true;
        continue; // already pushed
      }
      path.push({ x: cx, y: cy });
    }

    return path;
  }
}
