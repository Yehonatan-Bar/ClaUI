/**
 * Room templates for the dungeon.
 * Each room is a 5x5 tile layout where:
 *   0 = empty/void (will be wall from outside)
 *   1 = floor
 *   2 = wall (decorative interior wall)
 *   3 = torch position
 *   4 = door/entrance position
 *   5 = encounter object position (center)
 */

import type { RoomType } from './types';

export type RoomTemplate = number[][];

/** Library room - shelves with reading nooks */
const LIBRARY: RoomTemplate = [
  [2, 4, 1, 4, 2],
  [2, 1, 1, 1, 3],
  [3, 1, 5, 1, 2],
  [2, 1, 1, 1, 3],
  [2, 4, 1, 4, 2],
];

/** Forge room - walls around the anvil */
const FORGE: RoomTemplate = [
  [2, 4, 1, 4, 2],
  [3, 1, 1, 2, 3],
  [1, 1, 5, 1, 1],
  [3, 2, 1, 1, 3],
  [2, 4, 1, 4, 2],
];

/** Arena - pillars in corners for cover */
const ARENA: RoomTemplate = [
  [2, 4, 1, 4, 2],
  [1, 2, 1, 2, 1],
  [1, 1, 5, 1, 1],
  [1, 2, 1, 2, 1],
  [2, 4, 1, 4, 2],
];

/** Junction - crossroads with wall stubs */
const JUNCTION: RoomTemplate = [
  [2, 4, 1, 4, 2],
  [4, 1, 1, 1, 4],
  [1, 1, 5, 1, 1],
  [4, 1, 1, 1, 4],
  [2, 4, 1, 4, 2],
];

/** Vault - heavily walled treasure room */
const VAULT: RoomTemplate = [
  [2, 2, 4, 2, 2],
  [2, 1, 1, 1, 2],
  [3, 1, 5, 1, 3],
  [2, 1, 1, 1, 2],
  [2, 2, 1, 2, 2],
];

/** Lair - irregular walls for organic feel */
const LAIR: RoomTemplate = [
  [2, 4, 1, 4, 2],
  [1, 2, 1, 1, 1],
  [1, 1, 5, 1, 2],
  [1, 1, 1, 2, 1],
  [2, 1, 1, 4, 2],
];

/** Trap room - narrow zigzag path through hazards */
const TRAP_ROOM: RoomTemplate = [
  [2, 4, 1, 4, 2],
  [2, 1, 2, 1, 2],
  [1, 1, 5, 1, 1],
  [2, 1, 2, 1, 2],
  [2, 4, 1, 4, 2],
];

/** Throne room - pillars flanking the throne */
const THRONE: RoomTemplate = [
  [2, 4, 1, 4, 2],
  [3, 2, 1, 2, 3],
  [1, 1, 5, 1, 1],
  [3, 2, 1, 2, 3],
  [2, 4, 1, 4, 2],
];

/** Corridor - narrow winding passage */
const CORRIDOR: RoomTemplate = [
  [2, 4, 1, 4, 2],
  [2, 2, 1, 0, 2],
  [2, 0, 1, 0, 2],
  [2, 0, 1, 2, 2],
  [2, 4, 1, 4, 2],
];

/** Map room types to templates */
const ROOM_TEMPLATES: Record<RoomType, RoomTemplate> = {
  library: LIBRARY,
  forge: FORGE,
  arena: ARENA,
  junction: JUNCTION,
  vault: VAULT,
  lair: LAIR,
  trap_room: TRAP_ROOM,
  throne: THRONE,
  corridor: CORRIDOR,
};

export function getRoomTemplate(type: RoomType): RoomTemplate {
  return ROOM_TEMPLATES[type];
}

/** Room size in tiles (all rooms are 5x5) */
export const ROOM_SIZE = 5;

/** Corridor length between rooms in tiles */
export const CORRIDOR_LENGTH = 5;
