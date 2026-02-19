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

  // Busy state from Claude
  private _isBusy = false;

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

    // Start patrol quickly after load
    this.patrolCooldown = 1.0;

    // Start idle animation
    this.startIdleLoop();

    // Initial render
    this.render();
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
    }
  }

  /** Get tooltip text for the current state */
  get tooltipText(): string | null {
    return this._tooltipText;
  }

  // ====== STATE MACHINE ======

  private processNextBeat(): void {
    if (this.beatQueue.length === 0) {
      this.transitionTo('idle');
      return;
    }

    // Fast-forward if queue is too long
    while (this.beatQueue.length > 5) {
      const skipped = this.beatQueue.shift()!;
      this.maze.addBeat(skipped);
      this.maze.heroPos = { ...this.maze.heroTarget };
    }

    this.currentBeat = this.beatQueue.shift()!;
    this._tooltipText = this.buildTooltip(this.currentBeat);

    // Extend maze based on beat
    this.maze.addBeat(this.currentBeat);

    // Find path through maze corridors
    this.walkPath = this.maze.getPathToTarget();
    this.walkStep = 0;
    this.walkProgress = 0;

    // Scale walk speed for longer paths
    this.transitionTo('walking');
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

      // Smooth camera during idle
      this.maze.updateCamera(dt);

      // Idle patrol
      if (!this.isPatrolling && !this.isAtCampfire) {
        this.patrolCooldown -= dt;
        if (this.patrolCooldown <= 0) {
          this.startPatrol();
        }
      }

      if (this.isPatrolling) {
        this.updatePatrol(dt);
      }

      // Campfire after 20s idle
      if (this.idleTimer > 20 && !this.isAtCampfire && !this._isBusy) {
        this.isAtCampfire = true;
        this.isPatrolling = false;
      }

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

    // Dynamic speed: faster for longer paths
    const speed = Math.min(8, 4 + this.walkPath.length / 10);
    this.walkProgress += dt * speed;

    if (this.walkProgress >= 1) {
      this.walkProgress = 0;
      if (this.walkStep < this.walkPath.length) {
        this.maze.heroPos = { ...this.walkPath[this.walkStep] };
        this.walkStep++;
      }

      if (this.walkStep >= this.walkPath.length) {
        this.maze.heroPos = { ...this.maze.heroTarget };
        this.transitionTo('encounter');
      }
    }
  }

  private updateEncounter(_dt: number): void {
    this.encounterTimer++;
    if (this.encounterTimer > 60) {
      this.transitionTo('resolution');
    }
  }

  private updateResolution(_dt: number): void {
    this.resolutionTimer++;
    if (this.resolutionTimer > 30) {
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

    // Render particles
    this.renderParticles();

    // Render beat label
    if (this.currentBeat && (this.state === 'encounter' || this.state === 'resolution')) {
      this.renderLabel(this.currentBeat.labelShort);
    }

    // Render campfire if idle
    if (this.isAtCampfire) {
      this.renderCampfire();
    }
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
    const parts: string[] = [beat.labelShort];
    if (beat.tooltipDetail) {
      parts.push(beat.tooltipDetail);
    } else if (beat.toolNames.length > 0) {
      parts.push(beat.toolNames.join(', '));
    }
    return parts.join(' - ');
  }
}
