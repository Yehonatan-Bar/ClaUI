/**
 * Adventure Widget type definitions.
 * Defines the data model for the maze-based dungeon crawler session visualizer.
 */

export type AdventureBeatType =
  | 'scout'       // Grep/Glob - searching/exploring with lantern
  | 'read'        // Read - reading scrolls/books
  | 'carve'       // Edit/Write - mining/building at anvil
  | 'forge'       // Bash - forge/machine/combat
  | 'fork'        // Plan approval / AskUserQuestion - crossroads
  | 'trap'        // Single error - spikes/pit
  | 'monster'     // 2 consecutive errors - skeleton warrior
  | 'boss'        // 3+ consecutive errors - dragon
  | 'treasure'    // Success after errors / achievement unlock
  | 'checkpoint'  // Recovery - back on track
  | 'wander';     // Discussion (no tools) - walking corridor

export type RoomType =
  | 'library'     // For read/scout beats
  | 'forge'       // For carve/forge beats
  | 'arena'       // For forge (combat) beats
  | 'junction'    // For fork beats - crossroads with doors
  | 'vault'       // For treasure beats
  | 'lair'        // For monster beats
  | 'trap_room'   // For trap beats
  | 'throne'      // For boss beats - dragon lair
  | 'corridor';   // For wander/checkpoint beats

export interface AdventureBeat {
  turnIndex: number;
  timestamp: number;
  beat: AdventureBeatType;
  intensity: 1 | 2 | 3;
  outcome: 'success' | 'fail' | 'mixed' | 'neutral';
  toolNames: string[];
  labelShort: string;
  tooltipDetail?: string;
  roomType: RoomType;
  isHaikuEnhanced: boolean;
  achievementRarity?: string;
}

/** Direction the character can face/walk */
export type Direction = 'up' | 'down' | 'left' | 'right';

/** States of the adventure state machine */
export type AdventureState = 'idle' | 'walking' | 'encounter' | 'resolution';

/** A position on the maze grid (cell coordinates) */
export interface TilePos {
  x: number;
  y: number;
}

/** Sprite frame: 2D array of palette indices (0 = transparent) */
export type SpriteFrame = number[][];

/** An animated sprite with multiple frames */
export interface AnimatedSprite {
  frames: SpriteFrame[];
  /** Frames per second for this animation */
  fps: number;
}

/** Engine configuration for the maze-based widget */
export interface AdventureConfig {
  /** Canvas width in CSS pixels */
  canvasWidth: number;
  /** Canvas height in CSS pixels */
  canvasHeight: number;
  /** Cell size in CSS pixels (passage + wall) */
  cellSize: number;
  /** Wall line thickness in CSS pixels */
  wallThickness: number;
  /** Passage width in CSS pixels (cellSize - wallThickness) */
  passageWidth: number;
  /** Maze grid width in cells */
  mazeWidth: number;
  /** Maze grid height in cells */
  mazeHeight: number;
  /** Scale for mini sprites (pixels per sprite pixel) */
  heroScale: number;
}

export const DEFAULT_CONFIG: AdventureConfig = {
  canvasWidth: 120,
  canvasHeight: 120,
  cellSize: 10,
  wallThickness: 2,
  passageWidth: 8,
  mazeWidth: 220,
  mazeHeight: 220,
  heroScale: 2,
};
