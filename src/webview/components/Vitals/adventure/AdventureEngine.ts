/**
 * Adventure Engine - core state machine, animation loop, and canvas rendering.
 * Uses Maze class for thin-wall maze grid with mini sprites.
 */

import type { AdventureBeat, AdventureState, TilePos, AdventureConfig } from './types';
import { DEFAULT_CONFIG } from './types';
import { Maze } from './dungeon';
import {
  drawSprite,
  HERO_MINI_IDLE1, HERO_MINI_IDLE2,
  HERO_MINI_WALK1, HERO_MINI_WALK2,
  HERO_MINI_ACTION, HERO_MINI_SIT,
  MINI_SCROLL, MINI_LANTERN, MINI_ANVIL, MINI_CHEST, MINI_FLAG, MINI_SIGNPOST,
  MINI_CAMPFIRE1, MINI_CAMPFIRE2,
  getMiniEncounterSprites,
  getResolutionParticle,
  PALETTE,
  SPARKLE_SMALL,
  DUST_SMALL,
} from './sprites';
import type { SpriteFrame } from './types';

/** Simple particle for effects */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  sprite: SpriteFrame;
}

export class AdventureEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private config: AdventureConfig;
  private maze: Maze;

  // State machine
  private state: AdventureState = 'idle';
  private stateTimer = 0;

  // Beat queue
  private beatQueue: AdventureBeat[] = [];
  private currentBeat: AdventureBeat | null = null;

  // Animation
  private frameCount = 0;
  private rafId: number | null = null;
  private lastFrameTime = 0;
  private walkPath: TilePos[] = [];
  private walkStep = 0;
  private walkProgress = 0;
  private encounterTimer = 0;
  private resolutionTimer = 0;
  private isCatchupBeat = false;
  private isCurrentAmbientBeat = false;

  // Idle state
  private idleTimer = 0;
  private isAtCampfire = false;
  private idleIntervalId: ReturnType<typeof setInterval> | null = null;

  // Hero micro-movement
  private microOffsetX = 0;
  private microOffsetY = 0;
  private microPhase = 0;

  // Idle patrol
  private patrolPath: TilePos[] = [];
  private patrolIdx = 0;
  private patrolProgress = 0;
  private patrolCooldown = 0;
  private isPatrolling = false;

  // Ambient particles
  private ambientTimer = 0;

  // Particles
  private particles: Particle[] = [];

  // Tooltip
  private _tooltipText: string | null = null;

  // Semantic visuals (artifacts/commands/indicators)
  private artifactCounts = new Map<string, number>();
  private commandAuraTag: string | null = null;
  private commandAuraTimer = 0;
  private indicatorDanger = 0;
  private indicatorFocus = 0;
  private indicatorMomentum = 0;

  // Busy state from Claude
  private _isBusy = false;
  private activityWalkCooldown = 0;
  private idleWalkCooldown = 4;
  private readonly strictNoRevisit = true;
  private readonly debugEnabled = true;
  private beatSeq = 0;

  constructor(canvas: HTMLCanvasElement, config?: Partial<AdventureConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Cannot get 2D context');
    this.ctx = ctx;

    // Handle HiDPI
    const dpr = window.devicePixelRatio || 1;
    canvas.width = this.config.canvasWidth * dpr;
    canvas.height = this.config.canvasHeight * dpr;
    canvas.style.width = `${this.config.canvasWidth}px`;
    canvas.style.height = `${this.config.canvasHeight}px`;
    this.ctx.scale(dpr, dpr);

    // Pixel art: no smoothing
    this.ctx.imageSmoothingEnabled = false;

    // Initialize maze
    this.maze = new Maze(Date.now(), this.config);

    // In strict no-revisit mode, idle patrol is disabled because patrol loops revisit cells.
    this.patrolCooldown = this.strictNoRevisit ? Number.POSITIVE_INFINITY : 1.0;

    // Start idle animation
    this.startIdleLoop();

    // Initial render
    this.render();
    this.debug('Engine:init', {
      strictNoRevisit: this.strictNoRevisit,
      canvas: { width: this.config.canvasWidth, height: this.config.canvasHeight },
    });
  }

  private debug(event: string, payload?: Record<string, unknown>): void {
    if (!this.debugEnabled) return;
    const vscode = (window as any).acquireVsCodeApi?.();
    if (vscode) {
      vscode.postMessage({
        type: 'adventureDebugLog',
        source: 'engine',
        event,
        payload,
        ts: Date.now(),
      });
    }
    if (payload) {
      console.debug(`[AdventureDebug][Engine] ${event}`, payload);
      return;
    }
    console.debug(`[AdventureDebug][Engine] ${event}`);
  }

  /** Clean up resources */
  destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.idleIntervalId !== null) {
      clearInterval(this.idleIntervalId);
      this.idleIntervalId = null;
    }
  }

  /** Add a new beat from a turn event */
  addBeat(beat: AdventureBeat): void {
    this.applyBeatSemantics(beat);
    this.beatQueue.push(beat);
    this.idleTimer = 0;
    this.isAtCampfire = false;
    this.isPatrolling = false;

    if (this.state === 'idle') {
      this.processNextBeat();
    }
  }

  /** Signal busy/idle from Claude */
  setBusy(busy: boolean): void {
    this._isBusy = busy;
    if (busy) {
      this.idleTimer = 0;
      this.isAtCampfire = false;
      this.activityWalkCooldown = Math.min(this.activityWalkCooldown, 0.25);
      return;
    }

    // After activity ends, wait a bit before the next tiny idle roam.
    this.idleWalkCooldown = Math.max(this.idleWalkCooldown, 4 + Math.random() * 2);
  }

  /** Get tooltip text for the current state */
  get tooltipText(): string | null {
    return this._tooltipText;
  }

  // ====== STATE MACHINE ======

  private processNextBeat(): void {
    if (this.beatQueue.length === 0) {
      this.isCatchupBeat = false;
      this.isCurrentAmbientBeat = false;
      this.transitionTo('idle');
      return;
    }

    // Fast-forward only when queue is very long, but keep hero position so catch-up walk stays visible.
    let skippedCount = 0;
    while (this.beatQueue.length > 12) {
      const skipped = this.beatQueue.shift()!;
      this.maze.addBeat(skipped);
      skippedCount++;
    }

    this.currentBeat = this.beatQueue.shift()!;
    this.beatSeq++;
    this.isCatchupBeat = skippedCount > 0;
    this.isCurrentAmbientBeat = this.currentBeat.turnIndex < 0;
    this._tooltipText = this.buildTooltip(this.currentBeat);

    // Save the hero's current position BEFORE this walk starts so chooseFarTarget can compute
    // a forward vector (prev_start → current_pos) and avoid sending the hero backwards.
    const walkStart = { ...this.maze.heroPos };

    let movedInsideAddBeat = false;
    let walkedStepInPath: TilePos | undefined;
    if (this.isCurrentAmbientBeat) {
      // Ambient walks should always be possible; don't require fresh-only paths.
      this.maze.setAmbientTarget(this._isBusy);
      this.walkPath = this.maze.getPathToTarget();
    } else {
      // Extend maze based on beat
      this.maze.addBeat(this.currentBeat);
      movedInsideAddBeat = this.maze.heroPos.x !== walkStart.x || this.maze.heroPos.y !== walkStart.y;

      // Find path through maze corridors
      this.walkPath = this.maze.getFreshPathToTarget();
      walkedStepInPath = this.walkPath.find(step => this.maze.hasWalkedCell(step.x, step.y));
      if (this.walkPath.some(step => this.maze.hasWalkedCell(step.x, step.y))) {
        // Hard safety rail: never execute a path that includes a previously walked cell.
        this.walkPath = [];
        this.maze.heroTarget = { ...this.maze.heroPos };
      }
    }

    // Commit the walk-start snapshot AFTER target selection so it's available for the NEXT beat.
    this.maze.heroLastStart = walkStart;
    this.walkStep = 0;
    this.walkProgress = 0;
    this.debug('processNextBeat', {
      beatSeq: this.beatSeq,
      beatType: this.currentBeat.beat,
      queueAfterPop: this.beatQueue.length,
      skippedCount,
      catchup: this.isCatchupBeat,
      walkStart,
      heroPosAfterAddBeat: this.maze.heroPos,
      heroTarget: this.maze.heroTarget,
      movedInsideAddBeat,
      pathLen: this.walkPath.length,
      walkedStepInPath: walkedStepInPath ? { x: walkedStepInPath.x, y: walkedStepInPath.y } : null,
    });

    // Scale walk speed for longer paths
    this.transitionTo('walking');
  }

  private createAmbientBeat(active: boolean): AdventureBeat {
    return {
      turnIndex: -1,
      timestamp: Date.now(),
      beat: 'wander',
      intensity: active ? 2 : 1,
      outcome: 'neutral',
      toolNames: [],
      labelShort: '',
      roomType: 'corridor',
      isHaikuEnhanced: false,
    };
  }

  private maybeQueueAmbientWalk(dt: number): void {
    this.activityWalkCooldown = Math.max(0, this.activityWalkCooldown - dt);
    this.idleWalkCooldown = Math.max(0, this.idleWalkCooldown - dt);

    if (this.state !== 'idle' || this.beatQueue.length > 0) return;

    if (this._isBusy) {
      if (this.activityWalkCooldown <= 0) {
        this.addBeat(this.createAmbientBeat(true));
        // Keep activity motion visible, but not frantic.
        this.activityWalkCooldown = 0.6 + Math.random() * 0.5;
      }
      return;
    }

    if (this.idleWalkCooldown <= 0) {
      this.addBeat(this.createAmbientBeat(false));
      // Very subtle movement when idle.
      this.idleWalkCooldown = 3.5 + Math.random() * 2.5;
    }
  }

  private applyBeatSemantics(beat: AdventureBeat): void {
    const artifacts = beat.artifacts || [];
    for (const artifact of artifacts) {
      if (!artifact) continue;
      const prev = this.artifactCounts.get(artifact) || 0;
      this.artifactCounts.set(artifact, prev + 1);
    }

    const commandTags = beat.commandTags || [];
    if (commandTags.length > 0) {
      this.commandAuraTag = commandTags[commandTags.length - 1];
      this.commandAuraTimer = 4.5;
    }

    const indicators = beat.indicators || [];
    for (const indicator of indicators) {
      switch (indicator) {
        case 'error-pressure':
        case 'high-cost':
        case 'long-turn':
        case 'release-window':
          this.indicatorDanger = Math.min(1, this.indicatorDanger + 0.22);
          break;
        case 'momentum':
        case 'multi-tool':
        case 'assembly':
        case 'crafting':
          this.indicatorMomentum = Math.min(1, this.indicatorMomentum + 0.2);
          break;
        default:
          this.indicatorFocus = Math.min(1, this.indicatorFocus + 0.18);
          break;
      }
    }

    if (beat.outcome === 'fail') {
      this.indicatorDanger = Math.min(1, this.indicatorDanger + 0.28);
    } else if (beat.outcome === 'success') {
      this.indicatorMomentum = Math.min(1, this.indicatorMomentum + 0.12);
      this.indicatorFocus = Math.min(1, this.indicatorFocus + 0.08);
    }
  }

  private decaySemanticVisuals(dt: number): void {
    if (this.commandAuraTimer > 0) {
      this.commandAuraTimer = Math.max(0, this.commandAuraTimer - dt);
      if (this.commandAuraTimer <= 0) {
        this.commandAuraTag = null;
      }
    }

    this.indicatorDanger = Math.max(0, this.indicatorDanger - dt * 0.04);
    this.indicatorFocus = Math.max(0, this.indicatorFocus - dt * 0.03);
    this.indicatorMomentum = Math.max(0, this.indicatorMomentum - dt * 0.035);
  }

  private transitionTo(newState: AdventureState): void {
    this.state = newState;
    this.stateTimer = 0;

    switch (newState) {
      case 'idle':
        this.stopAnimationLoop();
        this.startIdleLoop();
        this._tooltipText = null;
        break;
      case 'walking':
        this.stopIdleLoop();
        this.microOffsetX = 0;
        this.microOffsetY = 0;
        this.startAnimationLoop();
        break;
      case 'encounter':
        this.encounterTimer = 0;
        break;
      case 'resolution':
        this.resolutionTimer = 0;
        this.spawnResolutionParticles();
        break;
    }
  }

  // ====== ANIMATION LOOP ======

  private startAnimationLoop(): void {
    if (this.rafId !== null) return;
    this.lastFrameTime = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - this.lastFrameTime) / 1000, 0.1); // cap at 100ms
      this.lastFrameTime = now;
      this.update(dt);
      this.render();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private stopAnimationLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private startIdleLoop(): void {
    if (this.idleIntervalId !== null) return;
    this.idleIntervalId = setInterval(() => {
      this.frameCount++;
      const dt = 0.125; // 1/8 second
      this.idleTimer += dt;
      this.microPhase += 0.2;
      this.ambientTimer += dt;

      // Breathing/fidget motion (1-2 pixel drift - smaller for mini sprites)
      this.microOffsetX = Math.sin(this.microPhase) * 1.5;
      this.microOffsetY = Math.sin(this.microPhase * 0.7 + 1.2) * 1;

      // Spawn ambient dust particles periodically
      if (this.ambientTimer > 0.8) {
        this.ambientTimer = 0;
        this.spawnAmbientParticle();
      }

      // Update particles
      this.updateParticles(dt);
      this.decaySemanticVisuals(dt);

      // Smooth camera during idle
      this.maze.updateCamera(dt);

      // Idle patrol (disabled in strict no-revisit mode).
      if (!this.strictNoRevisit) {
        if (!this.isPatrolling && !this.isAtCampfire) {
          this.patrolCooldown -= dt;
          if (this.patrolCooldown <= 0) {
            this.startPatrol();
          }
        }

        if (this.isPatrolling) {
          this.updatePatrol(dt);
        }
      }

      // Campfire after 20s idle
      if (this.idleTimer > 20 && !this.isAtCampfire && !this._isBusy) {
        this.isAtCampfire = true;
        this.isPatrolling = false;
      }

      // Keep moving during activity, and drift slowly even in long idle periods.
      this.maybeQueueAmbientWalk(dt);

      this.render();
    }, 125);
  }

  private stopIdleLoop(): void {
    if (this.idleIntervalId !== null) {
      clearInterval(this.idleIntervalId);
      this.idleIntervalId = null;
    }
    this.isPatrolling = false;
  }

  /** Start an idle patrol through nearby maze corridors */
  private startPatrol(): void {
    const targets = this.maze.getPatrolPath();
    if (targets.length <= 1) {
      this.patrolCooldown = 2;
      return;
    }

    // Build actual BFS paths between patrol waypoints
    this.patrolPath = [];
    let current = this.maze.heroPos;
    for (const target of targets) {
      const segment = this.maze.findPath(current.x, current.y, target.x, target.y);
      this.patrolPath.push(...segment);
      current = target;
    }

    if (this.patrolPath.length === 0) {
      this.patrolCooldown = 2;
      return;
    }

    this.patrolIdx = 0;
    this.patrolProgress = 0;
    this.isPatrolling = true;
  }

  /** Update patrol walking through maze paths */
  private updatePatrol(dt: number): void {
    if (this.patrolIdx >= this.patrolPath.length) {
      this.isPatrolling = false;
      this.patrolCooldown = 1.5 + Math.random() * 2;
      return;
    }

    this.patrolProgress += dt * 3; // 3 cells/sec patrol speed
    if (this.patrolProgress >= 1) {
      this.patrolProgress = 0;
      this.maze.heroPos = { ...this.patrolPath[this.patrolIdx] };
      this.patrolIdx++;
    }
  }

  /** Spawn a floating ambient dust/spark particle */
  private spawnAmbientParticle(): void {
    const { canvasWidth, canvasHeight } = this.config;
    const x = Math.random() * canvasWidth;
    const y = canvasHeight * 0.3 + Math.random() * canvasHeight * 0.5;

    this.particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 6,
      vy: -3 - Math.random() * 5,
      life: 1.5 + Math.random() * 1.5,
      maxLife: 3,
      sprite: Math.random() > 0.5 ? SPARKLE_SMALL : DUST_SMALL,
    });
  }

  // ====== UPDATE ======

  private update(dt: number): void {
    this.frameCount++;
    this.stateTimer += dt;

    // Smooth camera during active states
    this.maze.updateCamera(dt);

    // Update particles
    this.updateParticles(dt);
    this.decaySemanticVisuals(dt);

    switch (this.state) {
      case 'walking':
        this.updateWalking(dt);
        break;
      case 'encounter':
        this.updateEncounter(dt);
        break;
      case 'resolution':
        this.updateResolution(dt);
        break;
    }
  }

  private updateWalking(dt: number): void {
    if (this.walkPath.length === 0) {
      this.transitionTo('encounter');
      return;
    }

    // Slow baseline speed with gentle scaling.
    const speed = this.isCurrentAmbientBeat
      ? (this._isBusy ? 2.2 : 1.0)
      : Math.min(
        4.8,
        1.8 +
        Math.min(1.1, this.walkPath.length / 28) +
        Math.min(1.1, this.beatQueue.length * 0.18) +
        (this.isCatchupBeat ? 0.6 : 0)
      );
    this.walkProgress += dt * speed;

    while (this.walkProgress >= 1) {
      this.walkProgress -= 1;
      if (this.walkStep < this.walkPath.length) {
        const nextCell = this.walkPath[this.walkStep];
        if (!this.isCurrentAmbientBeat && this.maze.hasWalkedCell(nextCell.x, nextCell.y)) {
          // Never step onto a previously walked tile, even on edge-case race conditions.
          this.debug('updateWalking:guardHit', {
            beatSeq: this.beatSeq,
            nextCell,
            heroPos: this.maze.heroPos,
          });
          this.walkPath = [];
          this.maze.heroTarget = { ...this.maze.heroPos };
          this.transitionTo('encounter');
          return;
        }
        this.maze.heroPos = { ...nextCell };
        this.walkStep++;
      }

      if (this.walkStep >= this.walkPath.length) {
        this.maze.heroPos = { ...this.maze.heroTarget };
        // Record every cell walked so the next beat avoids sending the hero back over them.
        if (!this.isCurrentAmbientBeat) {
          this.maze.markCellsWalked(this.walkPath);
        }
        this.debug('updateWalking:arrive', {
          beatSeq: this.beatSeq,
          walkLen: this.walkPath.length,
          endPos: this.maze.heroPos,
          queueRemaining: this.beatQueue.length,
        });
        this.transitionTo('encounter');
        break;
      }
    }
  }

  private updateEncounter(dt: number): void {
    this.encounterTimer += dt;
    const duration = (this.isCatchupBeat || this.beatQueue.length > 0) ? 0.15 : 0.35;
    if (this.encounterTimer >= duration) {
      this.transitionTo('resolution');
    }
  }

  private updateResolution(dt: number): void {
    this.resolutionTimer += dt;
    const duration = (this.isCatchupBeat || this.beatQueue.length > 0) ? 0.08 : 0.18;
    if (this.resolutionTimer >= duration) {
      this.processNextBeat();
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 30 * dt;
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  private spawnResolutionParticles(): void {
    if (!this.currentBeat) return;
    const sprite = getResolutionParticle(this.currentBeat.beat);
    if (!sprite) return;

    const { cellSize, heroScale } = this.config;
    const heroScreenX = this.maze.heroPos.x * cellSize - this.maze.cameraX + cellSize / 2;
    const heroScreenY = this.maze.heroPos.y * cellSize - this.maze.cameraY;

    for (let i = 0; i < 5; i++) {
      this.particles.push({
        x: heroScreenX,
        y: heroScreenY,
        vx: (Math.random() - 0.5) * 40,
        vy: -20 - Math.random() * 30,
        life: 0.8 + Math.random() * 0.5,
        maxLife: 1.3,
        sprite,
      });
    }
  }

  // ====== RENDER ======

  private render(): void {
    const { canvasWidth, canvasHeight } = this.config;
    const ctx = this.ctx;

    // Clear canvas with dark background
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Render maze (floor + walls + torches)
    this.maze.renderMaze(ctx, canvasWidth, canvasHeight, this.frameCount);

    // Render encounter object
    if ((this.state === 'encounter' || this.state === 'resolution') && this.currentBeat) {
      this.renderEncounter();
    }

    // Render hero
    this.renderHero();
    this.renderCommandAura();

    // Render particles
    this.renderParticles();

    // Render beat label
    if (
      this.currentBeat &&
      this.currentBeat.labelShort.trim().length > 0 &&
      (this.state === 'encounter' || this.state === 'resolution')
    ) {
      this.renderLabel(this.currentBeat.labelShort);
    }

    // Render campfire if idle
    if (this.isAtCampfire) {
      this.renderCampfire();
    }

    // HUD overlays reacting to tool findings and session indicators.
    this.renderIndicatorPanel();
    this.renderArtifactPanel();
  }

  private renderHero(): void {
    const { cellSize, heroScale } = this.config;
    // Center the 4x4 sprite (8px at 2x scale) within the 10px cell
    const spriteSize = 4 * heroScale; // 8px
    const offset = (cellSize - spriteSize) / 2; // 1px centering

    let heroX: number;
    let heroY: number;

    if (this.state === 'walking' && this.walkPath.length > 0 && this.walkStep < this.walkPath.length) {
      const from = this.walkStep > 0 ? this.walkPath[this.walkStep - 1] : this.maze.heroPos;
      const to = this.walkPath[this.walkStep];
      heroX = (from.x + (to.x - from.x) * this.walkProgress) * cellSize - this.maze.cameraX + offset;
      heroY = (from.y + (to.y - from.y) * this.walkProgress) * cellSize - this.maze.cameraY + offset;
    } else {
      heroX = this.maze.heroPos.x * cellSize - this.maze.cameraX + offset;
      heroY = this.maze.heroPos.y * cellSize - this.maze.cameraY + offset;
    }

    // Apply idle micro-movement
    if (this.state === 'idle' || this.state === 'encounter') {
      heroX += this.microOffsetX;
      heroY += this.microOffsetY;
    }

    let sprite: SpriteFrame;
    switch (this.state) {
      case 'walking':
        sprite = Math.floor(this.frameCount / 8) % 2 === 0 ? HERO_MINI_WALK1 : HERO_MINI_WALK2;
        break;
      case 'encounter':
        sprite = HERO_MINI_ACTION;
        break;
      case 'idle':
        if (this.isAtCampfire) {
          sprite = HERO_MINI_SIT;
        } else if (this.isPatrolling) {
          sprite = Math.floor(this.frameCount / 3) % 2 === 0 ? HERO_MINI_WALK1 : HERO_MINI_WALK2;
        } else {
          sprite = Math.floor(this.frameCount / 4) % 2 === 0 ? HERO_MINI_IDLE1 : HERO_MINI_IDLE2;
        }
        break;
      default:
        sprite = HERO_MINI_IDLE1;
    }

    drawSprite(this.ctx, sprite, heroX, heroY, heroScale);
  }

  private renderCommandAura(): void {
    if (!this.commandAuraTag || this.commandAuraTimer <= 0) return;

    const { cellSize } = this.config;
    const centerX = this.maze.heroPos.x * cellSize - this.maze.cameraX + cellSize / 2;
    const centerY = this.maze.heroPos.y * cellSize - this.maze.cameraY + cellSize / 2;
    const pulse = 0.7 + Math.sin(this.frameCount * 0.22) * 0.3;
    const auraAlpha = Math.min(0.55, 0.2 + this.commandAuraTimer * 0.08) * pulse;

    let color = PALETTE[12]; // default cyan
    switch (this.commandAuraTag) {
      case 'git':
        color = PALETTE[6];
        break;
      case 'test':
        color = PALETTE[11];
        break;
      case 'build':
        color = PALETTE[4];
        break;
      case 'deploy':
        color = PALETTE[12];
        break;
      case 'search':
        color = PALETTE[5];
        break;
    }

    this.ctx.save();
    this.ctx.globalAlpha = auraAlpha;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, 8 + pulse * 4, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, 13 + pulse * 3, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private renderIndicatorPanel(): void {
    const x = 4;
    const y = 4;
    const w = 38;
    const barW = 28;
    const barH = 3;

    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    this.ctx.fillRect(x - 2, y - 2, w, 18);

    const bars = [
      { value: this.indicatorDanger, color: PALETTE[3], label: 'D' },
      { value: this.indicatorFocus, color: PALETTE[12], label: 'F' },
      { value: this.indicatorMomentum, color: PALETTE[6], label: 'M' },
    ];

    bars.forEach((bar, i) => {
      const by = y + i * 5;
      this.ctx.fillStyle = PALETTE[1];
      this.ctx.fillRect(x + 8, by, barW, barH);
      this.ctx.fillStyle = bar.color;
      this.ctx.fillRect(x + 8, by, Math.max(1, Math.floor(barW * bar.value)), barH);
      this.ctx.fillStyle = PALETTE[13];
      this.ctx.font = '6px monospace';
      this.ctx.fillText(bar.label, x, by + 3);
    });
  }

  private renderArtifactPanel(): void {
    if (this.artifactCounts.size === 0) return;

    const topArtifacts = Array.from(this.artifactCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    if (topArtifacts.length === 0) return;

    const panelWidth = 16 + topArtifacts.length * 20;
    const panelX = this.config.canvasWidth - panelWidth - 3;
    const panelY = this.config.canvasHeight - 14;

    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    this.ctx.fillRect(panelX, panelY, panelWidth, 12);

    topArtifacts.forEach(([artifact, count], idx) => {
      const icon = this.getArtifactIcon(artifact);
      const x = panelX + 3 + idx * 20;
      const y = panelY + 2;
      drawSprite(this.ctx, icon, x, y, 2);
      this.ctx.fillStyle = PALETTE[13];
      this.ctx.font = '6px monospace';
      this.ctx.fillText(String(count), x + 9, y + 7);
    });
  }

  private getArtifactIcon(artifact: string): SpriteFrame {
    if (artifact.includes('scroll') || artifact.includes('lore')) return MINI_SCROLL;
    if (artifact.includes('map') || artifact.includes('tracker')) return MINI_LANTERN;
    if (artifact.includes('rune') || artifact.includes('blueprint') || artifact.includes('gear')) return MINI_ANVIL;
    if (artifact.includes('portal') || artifact.includes('trial') || artifact.includes('commit')) return MINI_SIGNPOST;
    if (artifact.includes('checkpoint') || artifact.includes('junction')) return MINI_FLAG;
    return MINI_CHEST;
  }

  private renderEncounter(): void {
    if (!this.currentBeat) return;
    const { cellSize, heroScale } = this.config;

    const sprites = getMiniEncounterSprites(this.currentBeat.beat);
    if (sprites.length === 0) return;

    const spriteSize = 4 * heroScale;
    const offset = (cellSize - spriteSize) / 2;

    // Place encounter at the hero's target cell (offset slightly to the right)
    const encounterX = this.maze.heroTarget.x * cellSize - this.maze.cameraX + offset + cellSize;
    const encounterY = this.maze.heroTarget.y * cellSize - this.maze.cameraY + offset;

    const frameIdx = sprites.length > 1
      ? Math.floor(this.frameCount / 15) % sprites.length
      : 0;

    drawSprite(this.ctx, sprites[frameIdx], encounterX, encounterY, heroScale);
  }

  private renderCampfire(): void {
    const { cellSize, heroScale } = this.config;
    const spriteSize = 4 * heroScale;
    const offset = (cellSize - spriteSize) / 2;

    const cfX = this.maze.heroPos.x * cellSize - this.maze.cameraX + offset + cellSize;
    const cfY = this.maze.heroPos.y * cellSize - this.maze.cameraY + offset;

    const sprite = Math.floor(this.frameCount / 3) % 2 === 0 ? MINI_CAMPFIRE1 : MINI_CAMPFIRE2;
    drawSprite(this.ctx, sprite, cfX, cfY, heroScale);
  }

  private renderParticles(): void {
    const { heroScale } = this.config;
    for (const p of this.particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      this.ctx.globalAlpha = alpha;
      drawSprite(this.ctx, p.sprite, p.x, p.y, heroScale);
    }
    this.ctx.globalAlpha = 1;
  }

  private renderLabel(text: string): void {
    const { canvasWidth } = this.config;
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    this.ctx.fillRect(0, 0, canvasWidth, 12);
    this.ctx.fillStyle = PALETTE[5]; // gold color
    this.ctx.font = '9px monospace';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(text, canvasWidth / 2, 9);
    this.ctx.textAlign = 'start';
  }

  // ====== TOOLTIP ======

  private buildTooltip(beat: AdventureBeat): string {
    const parts: string[] = [];
    if (beat.labelShort.trim().length > 0) {
      parts.push(beat.labelShort);
    }
    if (beat.tooltipDetail) {
      parts.push(beat.tooltipDetail);
    } else if (beat.toolNames.length > 0) {
      parts.push(beat.toolNames.join(', '));
    }
    return parts.join(' - ');
  }
}
