/**
 * Pixel art sprite data for the Adventure Widget.
 * All sprites are 8x8 pixels, defined as 2D arrays of palette indices.
 * 0 = transparent, 1-16 = palette colors.
 *
 * PICO-8 inspired palette tuned for dark VS Code backgrounds.
 */

import type { SpriteFrame } from './types';

// --- Color Palette ---
export const PALETTE: string[] = [
  'transparent',  // 0
  '#1a1c2c',      // 1  - dark outline / void
  '#5d275d',      // 2  - dark purple
  '#b13e53',      // 3  - red / danger
  '#ef7d57',      // 4  - orange / fire
  '#ffcd75',      // 5  - gold / treasure
  '#a7f070',      // 6  - green / success
  '#38b764',      // 7  - dark green
  '#257179',      // 8  - teal
  '#29366f',      // 9  - dark blue
  '#3b5dc9',      // 10 - blue
  '#41a6f6',      // 11 - light blue
  '#73eff7',      // 12 - cyan / magic
  '#f4f4f4',      // 13 - white / highlight
  '#94b0c2',      // 14 - light gray
  '#566c86',      // 15 - gray
  '#333c57',      // 16 - dark gray / stone
];

// --- Helper: Draw a sprite frame onto a canvas context ---
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: SpriteFrame,
  x: number,
  y: number,
  scale: number = 2,
  flipX: boolean = false,
): void {
  const h = sprite.length;
  const w = h > 0 ? sprite[0].length : 0;
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const colorIdx = sprite[row][col];
      if (colorIdx === 0) continue;
      ctx.fillStyle = PALETTE[colorIdx];
      const drawCol = flipX ? (w - 1 - col) : col;
      ctx.fillRect(x + drawCol * scale, y + row * scale, scale, scale);
    }
  }
}

// =====================================================
// HERO SPRITES
// =====================================================

export const HERO_IDLE_1: SpriteFrame = [
  [0, 0, 0, 5, 5, 0, 0, 0],
  [0, 0, 5, 5, 5, 5, 0, 0],
  [0, 0, 14, 13, 13, 14, 0, 0],
  [0, 0, 14, 1, 1, 14, 0, 0],
  [0, 0, 10, 10, 10, 10, 0, 0],
  [0, 0, 10, 10, 10, 10, 0, 0],
  [0, 0, 14, 0, 0, 14, 0, 0],
  [0, 0, 1, 0, 0, 1, 0, 0],
];

export const HERO_IDLE_2: SpriteFrame = [
  [0, 0, 0, 5, 5, 0, 0, 0],
  [0, 0, 5, 5, 5, 5, 0, 0],
  [0, 0, 14, 13, 13, 14, 0, 0],
  [0, 0, 14, 1, 1, 14, 0, 0],
  [0, 0, 10, 10, 10, 10, 0, 0],
  [0, 0, 10, 10, 10, 10, 0, 0],
  [0, 0, 0, 14, 14, 0, 0, 0],
  [0, 0, 0, 1, 1, 0, 0, 0],
];

export const HERO_WALK_1: SpriteFrame = [
  [0, 0, 0, 5, 5, 0, 0, 0],
  [0, 0, 5, 5, 5, 5, 0, 0],
  [0, 0, 14, 13, 13, 14, 0, 0],
  [0, 0, 14, 1, 1, 14, 0, 0],
  [0, 0, 10, 10, 10, 10, 0, 0],
  [0, 0, 10, 10, 10, 10, 0, 0],
  [0, 14, 0, 0, 0, 0, 14, 0],
  [0, 1, 0, 0, 0, 0, 1, 0],
];

export const HERO_WALK_2: SpriteFrame = [
  [0, 0, 0, 5, 5, 0, 0, 0],
  [0, 0, 5, 5, 5, 5, 0, 0],
  [0, 0, 14, 13, 13, 14, 0, 0],
  [0, 0, 14, 1, 1, 14, 0, 0],
  [0, 0, 10, 10, 10, 10, 0, 0],
  [0, 0, 10, 10, 10, 10, 0, 0],
  [0, 0, 14, 0, 0, 14, 0, 0],
  [0, 0, 1, 0, 0, 1, 0, 0],
];

export const HERO_ACTION: SpriteFrame = [
  [0, 0, 0, 5, 5, 0, 0, 0],
  [0, 0, 5, 5, 5, 5, 14, 0],
  [0, 0, 14, 13, 13, 14, 14, 0],
  [0, 0, 14, 1, 1, 14, 15, 0],
  [0, 0, 10, 10, 10, 10, 0, 0],
  [0, 0, 10, 10, 10, 10, 0, 0],
  [0, 0, 14, 0, 0, 14, 0, 0],
  [0, 0, 1, 0, 0, 1, 0, 0],
];

export const HERO_SIT: SpriteFrame = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 5, 5, 0, 0, 0],
  [0, 0, 5, 5, 5, 5, 0, 0],
  [0, 0, 14, 13, 13, 14, 0, 0],
  [0, 0, 14, 1, 1, 14, 0, 0],
  [0, 0, 10, 10, 10, 10, 0, 0],
  [0, 14, 10, 10, 10, 10, 14, 0],
  [0, 1, 1, 1, 1, 1, 1, 0],
];

// =====================================================
// ENCOUNTER SPRITES
// =====================================================

/** Glowing scroll on a pedestal */
export const SCROLL: SpriteFrame = [
  [0, 0, 0, 12, 12, 0, 0, 0],
  [0, 0, 12, 13, 13, 12, 0, 0],
  [0, 0, 13, 14, 14, 13, 0, 0],
  [0, 0, 13, 1, 1, 13, 0, 0],
  [0, 0, 13, 14, 14, 13, 0, 0],
  [0, 0, 12, 13, 13, 12, 0, 0],
  [0, 0, 0, 15, 15, 0, 0, 0],
  [0, 0, 15, 16, 16, 15, 0, 0],
];

/** Lantern for scouting/searching */
export const LANTERN: SpriteFrame = [
  [0, 0, 0, 5, 5, 0, 0, 0],
  [0, 0, 5, 4, 4, 5, 0, 0],
  [0, 0, 15, 4, 4, 15, 0, 0],
  [0, 0, 15, 5, 5, 15, 0, 0],
  [0, 0, 0, 15, 15, 0, 0, 0],
  [0, 0, 0, 15, 15, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
];

/** Anvil with sparks */
export const ANVIL: SpriteFrame = [
  [0, 0, 0, 4, 4, 0, 0, 0],
  [0, 0, 4, 0, 0, 5, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 15, 15, 15, 15, 15, 15, 0],
  [0, 0, 16, 16, 16, 16, 0, 0],
  [0, 0, 16, 16, 16, 16, 0, 0],
  [0, 16, 16, 0, 0, 16, 16, 0],
  [0, 16, 16, 0, 0, 16, 16, 0],
];

/** Skeleton warrior */
export const SKELETON_1: SpriteFrame = [
  [0, 0, 0, 13, 13, 0, 0, 0],
  [0, 0, 13, 13, 13, 13, 0, 0],
  [0, 0, 13, 3, 3, 13, 0, 0],
  [0, 0, 0, 13, 13, 0, 0, 0],
  [0, 14, 13, 13, 13, 13, 14, 0],
  [0, 0, 0, 13, 13, 0, 0, 0],
  [0, 0, 13, 0, 0, 13, 0, 0],
  [0, 0, 13, 0, 0, 13, 0, 0],
];

export const SKELETON_2: SpriteFrame = [
  [0, 0, 0, 13, 13, 0, 0, 0],
  [0, 0, 13, 13, 13, 13, 0, 0],
  [0, 0, 13, 3, 3, 13, 0, 0],
  [0, 0, 0, 13, 13, 0, 15, 0],
  [0, 0, 13, 13, 13, 13, 15, 0],
  [0, 0, 0, 13, 13, 0, 0, 0],
  [0, 13, 0, 0, 0, 0, 13, 0],
  [0, 13, 0, 0, 0, 0, 13, 0],
];

/** Signpost (crossroads / fork) */
export const SIGNPOST: SpriteFrame = [
  [0, 15, 15, 15, 15, 0, 0, 0],
  [0, 0, 0, 16, 0, 0, 0, 0],
  [0, 0, 0, 16, 15, 15, 15, 0],
  [0, 0, 0, 16, 0, 0, 0, 0],
  [0, 0, 0, 16, 0, 0, 0, 0],
  [0, 0, 0, 16, 0, 0, 0, 0],
  [0, 0, 0, 16, 0, 0, 0, 0],
  [0, 0, 15, 16, 15, 0, 0, 0],
];

/** Treasure chest - closed */
export const CHEST_CLOSED: SpriteFrame = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 4, 4, 4, 4, 4, 4, 0],
  [0, 4, 4, 5, 5, 4, 4, 0],
  [0, 4, 4, 4, 4, 4, 4, 0],
  [0, 4, 4, 5, 5, 4, 4, 0],
  [0, 4, 4, 4, 4, 4, 4, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
];

/** Treasure chest - open with gold */
export const CHEST_OPEN: SpriteFrame = [
  [0, 4, 4, 4, 4, 4, 4, 0],
  [0, 4, 1, 1, 1, 1, 4, 0],
  [0, 4, 4, 4, 4, 4, 4, 0],
  [0, 4, 5, 5, 5, 5, 4, 0],
  [0, 4, 5, 5, 5, 5, 4, 0],
  [0, 4, 4, 4, 4, 4, 4, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
];

/** Dragon head - frame 1 */
export const DRAGON_1: SpriteFrame = [
  [0, 3, 0, 0, 0, 0, 3, 0],
  [0, 3, 3, 3, 3, 3, 3, 0],
  [0, 3, 5, 3, 3, 5, 3, 0],
  [3, 3, 3, 3, 3, 3, 3, 3],
  [3, 3, 3, 3, 3, 3, 3, 3],
  [0, 3, 13, 0, 0, 13, 3, 0],
  [0, 0, 3, 3, 3, 3, 0, 0],
  [0, 0, 0, 4, 4, 0, 0, 0],
];

/** Dragon head - frame 2 (breathing fire) */
export const DRAGON_2: SpriteFrame = [
  [0, 3, 0, 0, 0, 0, 3, 0],
  [0, 3, 3, 3, 3, 3, 3, 0],
  [0, 3, 5, 3, 3, 5, 3, 0],
  [3, 3, 3, 3, 3, 3, 3, 3],
  [3, 3, 3, 3, 3, 3, 3, 3],
  [0, 3, 4, 4, 4, 4, 3, 0],
  [0, 0, 4, 5, 5, 4, 0, 0],
  [0, 4, 5, 4, 4, 5, 4, 0],
];

/** Spike trap */
export const SPIKES: SpriteFrame = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 15, 0, 15, 0, 15, 0, 0],
  [0, 15, 0, 15, 0, 15, 0, 0],
  [15, 15, 15, 15, 15, 15, 15, 0],
  [16, 16, 16, 16, 16, 16, 16, 0],
];

/** Campfire - frame 1 */
export const CAMPFIRE_1: SpriteFrame = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 5, 0, 0, 0, 0],
  [0, 0, 4, 5, 4, 0, 0, 0],
  [0, 0, 4, 4, 5, 4, 0, 0],
  [0, 0, 3, 4, 4, 3, 0, 0],
  [0, 0, 3, 3, 3, 3, 0, 0],
  [0, 4, 16, 16, 16, 16, 4, 0],
  [0, 0, 4, 16, 16, 4, 0, 0],
];

/** Campfire - frame 2 */
export const CAMPFIRE_2: SpriteFrame = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 5, 0, 0, 0],
  [0, 0, 0, 5, 4, 0, 0, 0],
  [0, 0, 4, 5, 4, 4, 0, 0],
  [0, 0, 4, 4, 3, 3, 0, 0],
  [0, 0, 3, 3, 3, 3, 0, 0],
  [0, 4, 16, 16, 16, 16, 4, 0],
  [0, 0, 4, 16, 16, 4, 0, 0],
];

/** Flag / checkpoint banner */
export const FLAG: SpriteFrame = [
  [0, 0, 16, 6, 6, 6, 0, 0],
  [0, 0, 16, 6, 7, 6, 0, 0],
  [0, 0, 16, 6, 6, 6, 0, 0],
  [0, 0, 16, 0, 0, 0, 0, 0],
  [0, 0, 16, 0, 0, 0, 0, 0],
  [0, 0, 16, 0, 0, 0, 0, 0],
  [0, 0, 16, 0, 0, 0, 0, 0],
  [0, 15, 16, 15, 0, 0, 0, 0],
];

// =====================================================
// TILE SPRITES (dungeon building blocks)
// =====================================================

/** Stone floor - variant 1 */
export const FLOOR_1: SpriteFrame = [
  [16, 16, 16, 16, 16, 16, 16, 16],
  [16, 15, 16, 16, 16, 16, 15, 16],
  [16, 16, 16, 16, 16, 16, 16, 16],
  [16, 16, 16, 15, 16, 16, 16, 16],
  [16, 16, 16, 16, 16, 16, 16, 16],
  [16, 16, 16, 16, 16, 15, 16, 16],
  [16, 15, 16, 16, 16, 16, 16, 16],
  [16, 16, 16, 16, 16, 16, 16, 16],
];

/** Stone floor - variant 2 */
export const FLOOR_2: SpriteFrame = [
  [16, 16, 16, 16, 16, 16, 16, 16],
  [16, 16, 16, 15, 16, 16, 16, 16],
  [16, 16, 16, 16, 16, 16, 16, 16],
  [16, 16, 16, 16, 16, 16, 15, 16],
  [16, 15, 16, 16, 16, 16, 16, 16],
  [16, 16, 16, 16, 16, 16, 16, 16],
  [16, 16, 16, 16, 15, 16, 16, 16],
  [16, 16, 16, 16, 16, 16, 16, 16],
];

/** Solid wall */
export const WALL: SpriteFrame = [
  [1, 1, 1, 1, 1, 1, 1, 1],
  [1, 9, 9, 9, 1, 9, 9, 1],
  [1, 9, 9, 9, 1, 9, 9, 1],
  [1, 1, 1, 1, 1, 1, 1, 1],
  [1, 9, 1, 9, 9, 9, 1, 9],
  [1, 9, 1, 9, 9, 9, 1, 9],
  [1, 9, 1, 9, 9, 9, 1, 9],
  [1, 1, 1, 1, 1, 1, 1, 1],
];

/** Wall torch - frame 1 */
export const TORCH_1: SpriteFrame = [
  [0, 0, 0, 5, 0, 0, 0, 0],
  [0, 0, 4, 5, 4, 0, 0, 0],
  [0, 0, 0, 4, 0, 0, 0, 0],
  [0, 0, 0, 16, 0, 0, 0, 0],
  [0, 0, 0, 16, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
];

/** Wall torch - frame 2 */
export const TORCH_2: SpriteFrame = [
  [0, 0, 5, 0, 0, 0, 0, 0],
  [0, 0, 4, 4, 5, 0, 0, 0],
  [0, 0, 0, 4, 0, 0, 0, 0],
  [0, 0, 0, 16, 0, 0, 0, 0],
  [0, 0, 0, 16, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
];

/** Door (open) */
export const DOOR_OPEN: SpriteFrame = [
  [4, 4, 0, 0, 0, 0, 4, 4],
  [4, 4, 0, 0, 0, 0, 4, 4],
  [4, 4, 0, 0, 0, 0, 4, 4],
  [4, 4, 0, 0, 0, 0, 4, 4],
  [4, 4, 0, 0, 0, 0, 4, 4],
  [4, 4, 0, 0, 0, 0, 4, 4],
  [4, 4, 0, 0, 0, 0, 4, 4],
  [16, 16, 16, 16, 16, 16, 16, 16],
];

// =====================================================
// PARTICLE SPRITES (small, for effects)
// =====================================================

/** Gold coin particle (4x4) */
export const COIN: SpriteFrame = [
  [0, 5, 5, 0],
  [5, 5, 4, 5],
  [5, 4, 5, 5],
  [0, 5, 5, 0],
];

/** Fire particle (4x4) */
export const FIRE_PARTICLE: SpriteFrame = [
  [0, 4, 0, 0],
  [4, 5, 4, 0],
  [0, 3, 4, 0],
  [0, 0, 3, 0],
];

/** Sparkle (4x4) */
export const SPARKLE: SpriteFrame = [
  [0, 12, 0, 0],
  [12, 13, 12, 0],
  [0, 12, 0, 0],
  [0, 0, 0, 0],
];

/** Tiny sparkle for ambient dust (2x2) */
export const SPARKLE_SMALL: SpriteFrame = [
  [12, 0],
  [0, 12],
];

/** Tiny dust mote for ambient floating (2x2) */
export const DUST_SMALL: SpriteFrame = [
  [15, 0],
  [0, 15],
];

// =====================================================
// ENCOUNTER SPRITE MAP - maps beat type to sprite(s)
// =====================================================

import type { AdventureBeatType } from './types';

export function getEncounterSprites(beat: AdventureBeatType): SpriteFrame[] {
  switch (beat) {
    case 'read':      return [SCROLL];
    case 'scout':     return [LANTERN];
    case 'carve':     return [ANVIL];
    case 'forge':     return [ANVIL];
    case 'fork':      return [SIGNPOST];
    case 'trap':      return [SPIKES];
    case 'monster':   return [SKELETON_1, SKELETON_2];
    case 'boss':      return [DRAGON_1, DRAGON_2];
    case 'treasure':  return [CHEST_CLOSED, CHEST_OPEN];
    case 'checkpoint': return [FLAG];
    case 'wander':    return [];
  }
}

/** Get the resolution particle sprites for a beat outcome */
export function getResolutionParticle(beat: AdventureBeatType): SpriteFrame | null {
  switch (beat) {
    case 'treasure':   return COIN;
    case 'boss':
    case 'trap':
    case 'monster':    return FIRE_PARTICLE;
    case 'checkpoint': return SPARKLE;
    case 'read':
    case 'scout':      return SPARKLE;
    default:           return null;
  }
}

// =====================================================
// MINI SPRITES (4x4 pixels) for maze view
// At heroScale=2, these render as 8x8 CSS pixels, fitting in 8px passages
// =====================================================

// --- Mini Hero ---
export const HERO_MINI_IDLE1: SpriteFrame = [
  [0, 5, 5, 0],    // gold hat
  [0, 13, 13, 0],  // face
  [0, 10, 10, 0],  // blue body
  [0, 14, 14, 0],  // legs
];

export const HERO_MINI_IDLE2: SpriteFrame = [
  [0, 5, 5, 0],    // gold hat
  [0, 13, 13, 0],  // face
  [0, 10, 10, 0],  // blue body
  [0, 0, 14, 0],   // weight shift
];

export const HERO_MINI_WALK1: SpriteFrame = [
  [0, 5, 5, 0],    // gold hat
  [0, 13, 13, 0],  // face
  [0, 10, 10, 0],  // blue body
  [14, 0, 0, 14],  // legs apart
];

export const HERO_MINI_WALK2: SpriteFrame = [
  [0, 5, 5, 0],    // gold hat
  [0, 13, 13, 0],  // face
  [0, 10, 10, 0],  // blue body
  [0, 14, 14, 0],  // legs together
];

export const HERO_MINI_ACTION: SpriteFrame = [
  [0, 5, 5, 0],    // gold hat
  [0, 13, 13, 14], // face + arm raised
  [0, 10, 10, 0],  // blue body
  [0, 14, 14, 0],  // legs
];

export const HERO_MINI_SIT: SpriteFrame = [
  [0, 0, 0, 0],    // empty (lower)
  [0, 5, 5, 0],    // gold hat
  [0, 13, 13, 0],  // face
  [10, 10, 10, 10], // sitting body wide
];

// --- Mini Encounters ---
export const MINI_SCROLL: SpriteFrame = [
  [0, 12, 12, 0],  // glow
  [0, 13, 13, 0],  // scroll top
  [0, 14, 14, 0],  // scroll body
  [0, 15, 15, 0],  // pedestal
];

export const MINI_LANTERN: SpriteFrame = [
  [0, 5, 5, 0],    // flame
  [0, 4, 4, 0],    // fire
  [15, 4, 4, 15],  // lantern body
  [0, 15, 15, 0],  // handle
];

export const MINI_ANVIL: SpriteFrame = [
  [0, 4, 0, 5],    // sparks
  [15, 15, 15, 15], // anvil top
  [0, 16, 16, 0],  // anvil body
  [0, 16, 16, 0],  // anvil base
];

export const MINI_SKELETON: SpriteFrame = [
  [0, 13, 13, 0],  // skull
  [0, 13, 13, 0],  // head
  [14, 13, 13, 14], // arms+torso
  [0, 13, 13, 0],  // legs
];

export const MINI_DRAGON: SpriteFrame = [
  [3, 0, 0, 3],    // horns
  [3, 3, 3, 3],    // head
  [0, 5, 5, 0],    // eyes
  [0, 4, 4, 0],    // fire breath
];

export const MINI_CHEST: SpriteFrame = [
  [4, 4, 4, 4],    // lid
  [4, 5, 5, 4],    // gold showing
  [4, 4, 4, 4],    // body
  [0, 0, 0, 0],    // empty
];

export const MINI_SPIKES: SpriteFrame = [
  [0, 0, 0, 0],    // empty
  [0, 15, 0, 15],  // spike tips
  [15, 15, 15, 15], // spike middle
  [16, 16, 16, 16], // base
];

export const MINI_SIGNPOST: SpriteFrame = [
  [15, 15, 15, 0], // top sign
  [0, 0, 16, 0],   // post
  [0, 0, 16, 15],  // post + bottom sign
  [0, 0, 16, 0],   // post base
];

export const MINI_FLAG: SpriteFrame = [
  [16, 6, 6, 6],   // pole + flag
  [16, 0, 6, 6],   // pole + flag
  [16, 0, 0, 0],   // pole
  [16, 0, 0, 0],   // pole base
];

// --- Mini Campfire ---
export const MINI_CAMPFIRE1: SpriteFrame = [
  [0, 0, 5, 0],    // flame tip
  [0, 4, 5, 4],    // flame body
  [0, 3, 4, 3],    // embers
  [4, 16, 16, 4],  // logs
];

export const MINI_CAMPFIRE2: SpriteFrame = [
  [0, 5, 0, 0],    // flame tip (shifted)
  [0, 5, 4, 0],    // flame body
  [0, 4, 3, 3],    // embers
  [4, 16, 16, 4],  // logs
];

/** Get mini encounter sprites for the maze view */
export function getMiniEncounterSprites(beat: AdventureBeatType): SpriteFrame[] {
  switch (beat) {
    case 'read':       return [MINI_SCROLL];
    case 'scout':      return [MINI_LANTERN];
    case 'carve':      return [MINI_ANVIL];
    case 'forge':      return [MINI_ANVIL];
    case 'fork':       return [MINI_SIGNPOST];
    case 'trap':       return [MINI_SPIKES];
    case 'monster':    return [MINI_SKELETON];
    case 'boss':       return [MINI_DRAGON];
    case 'treasure':   return [MINI_CHEST];
    case 'checkpoint': return [MINI_FLAG];
    case 'wander':     return [];
  }
}
