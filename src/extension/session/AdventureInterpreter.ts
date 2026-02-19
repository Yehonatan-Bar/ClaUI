/**
 * AdventureInterpreter - converts TurnRecord data into AdventureBeat events.
 *
 * Layer 1: Hard-coded deterministic rules (always runs, instant, free).
 * Layer 2: Haiku AI classification (Phase 4 - only for ambiguous/dramatic moments).
 *
 * One beat per turn. Each turnComplete produces exactly one AdventureBeat.
 */

import type { TurnRecord } from '../types/webview-messages';

/** AdventureBeat types - matches webview types.ts */
type AdventureBeatType =
  | 'scout' | 'read' | 'carve' | 'forge' | 'fork'
  | 'trap' | 'monster' | 'boss' | 'treasure' | 'checkpoint' | 'wander';

type RoomType =
  | 'library' | 'forge' | 'arena' | 'junction' | 'vault'
  | 'lair' | 'trap_room' | 'throne' | 'corridor';

interface AdventureBeatPayload {
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

/** Tool name sets for beat classification */
const READ_TOOLS = ['Read'];
const SCOUT_TOOLS = ['Grep', 'Glob', 'WebSearch', 'WebFetch'];
const WRITE_TOOLS = ['Write', 'Edit', 'NotebookEdit', 'MultiEdit'];
const BASH_TOOLS = ['Bash', 'Terminal'];
const FORK_TOOLS = ['ExitPlanMode', 'AskUserQuestion'];

/** Beat → Room mapping */
const BEAT_ROOM_MAP: Record<AdventureBeatType, RoomType> = {
  scout: 'library',
  read: 'library',
  carve: 'forge',
  forge: 'arena',
  fork: 'junction',
  trap: 'trap_room',
  monster: 'lair',
  boss: 'throne',
  treasure: 'vault',
  checkpoint: 'corridor',
  wander: 'corridor',
};

/** Beat → Short label mapping */
const BEAT_LABELS: Record<AdventureBeatType, string> = {
  scout: 'Searching the map',
  read: 'Reading scrolls',
  carve: 'Mining the wall',
  forge: 'Working the forge',
  fork: 'Crossroads',
  trap: 'Trap!',
  monster: 'Monster!',
  boss: 'Boss fight!',
  treasure: 'Victory!',
  checkpoint: 'Safe ground',
  wander: 'Exploring...',
};

export class AdventureInterpreter {
  private log: (msg: string) => void = () => {};

  /** Track consecutive errors for escalation (trap → monster → boss) */
  private consecutiveErrors = 0;
  /** Track consecutive successes for checkpoint detection */
  private consecutiveSuccesses = 0;
  /** Whether the last turn had an error (for recovery/treasure detection) */
  private lastTurnWasError = false;

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  /** Reset state on session clear/restart */
  reset(): void {
    this.consecutiveErrors = 0;
    this.consecutiveSuccesses = 0;
    this.lastTurnWasError = false;
  }

  /**
   * Interpret a completed turn and produce an AdventureBeat.
   * Priority: Error conditions > Achievement > Fork > Tool-based > Default
   */
  interpret(turn: TurnRecord, achievementRarity?: string): AdventureBeatPayload {
    const baseNames = turn.toolNames.map(n =>
      n.includes('__') ? n.split('__').pop()! : n
    );

    let beat: AdventureBeatType;
    let intensity: 1 | 2 | 3 = 1;
    let outcome: 'success' | 'fail' | 'mixed' | 'neutral' = 'neutral';

    // --- Error conditions (highest priority) ---
    if (turn.isError) {
      this.consecutiveErrors++;
      this.consecutiveSuccesses = 0;
      this.lastTurnWasError = true;

      if (this.consecutiveErrors >= 3) {
        beat = 'boss';
        intensity = 3;
      } else if (this.consecutiveErrors >= 2) {
        beat = 'monster';
        intensity = 2;
      } else {
        beat = 'trap';
        intensity = 1;
      }
      outcome = 'fail';
    }
    // --- Recovery: success after error(s) ---
    else if (this.lastTurnWasError) {
      beat = 'treasure';
      intensity = this.consecutiveErrors >= 3 ? 3 : this.consecutiveErrors >= 2 ? 2 : 1;
      outcome = 'success';
      this.consecutiveErrors = 0;
      this.consecutiveSuccesses = 1;
      this.lastTurnWasError = false;
    }
    // --- Achievement unlock ---
    else if (achievementRarity) {
      beat = 'treasure';
      intensity = achievementRarity === 'legendary' ? 3 : achievementRarity === 'epic' ? 3 : 2;
      outcome = 'success';
      this.consecutiveErrors = 0;
      this.consecutiveSuccesses++;
      this.lastTurnWasError = false;
    }
    // --- Fork (plan approval / question) ---
    else if (baseNames.some(n => FORK_TOOLS.includes(n))) {
      beat = 'fork';
      intensity = 1;
      outcome = 'neutral';
      this.consecutiveErrors = 0;
      this.consecutiveSuccesses++;
      this.lastTurnWasError = false;
    }
    // --- Tool-based mapping ---
    else {
      this.consecutiveErrors = 0;
      this.consecutiveSuccesses++;
      this.lastTurnWasError = false;

      if (baseNames.some(n => WRITE_TOOLS.includes(n))) {
        beat = 'carve';
        intensity = baseNames.filter(n => WRITE_TOOLS.includes(n)).length > 2 ? 2 : 1;
        outcome = 'success';
      } else if (baseNames.some(n => BASH_TOOLS.includes(n))) {
        beat = 'forge';
        intensity = 1;
        outcome = 'success';
      } else if (baseNames.some(n => READ_TOOLS.includes(n))) {
        beat = 'read';
        intensity = 1;
        outcome = 'success';
      } else if (baseNames.some(n => SCOUT_TOOLS.includes(n))) {
        beat = 'scout';
        intensity = 1;
        outcome = 'success';
      } else if (baseNames.length === 0) {
        beat = 'wander';
        intensity = 1;
        outcome = 'neutral';
      } else {
        // Checkpoint after sustained success
        if (this.consecutiveSuccesses >= 3) {
          beat = 'checkpoint';
        } else {
          beat = 'wander';
        }
        intensity = 1;
        outcome = 'success';
      }
    }

    // Build tooltip detail from tool names
    let tooltipDetail: string | undefined;
    if (turn.toolNames.length > 0) {
      tooltipDetail = turn.toolNames.join(', ');
    }

    const payload: AdventureBeatPayload = {
      turnIndex: turn.turnIndex,
      timestamp: turn.timestamp,
      beat,
      intensity,
      outcome,
      toolNames: turn.toolNames,
      labelShort: BEAT_LABELS[beat],
      tooltipDetail,
      roomType: BEAT_ROOM_MAP[beat],
      isHaikuEnhanced: false,
      achievementRarity,
    };

    this.log(
      `[Adventure] Turn ${turn.turnIndex}: ${beat} (${outcome}, intensity=${intensity}) ` +
      `tools=[${baseNames.join(',')}] errors=${this.consecutiveErrors}`
    );

    return payload;
  }
}
