/**
 * Adventure Engine - core state machine, animation loop, and canvas rendering.
 * Manages the dungeon crawler visualization driven by AdventureBeat events.
 */

import type { AdventureBeat, AdventureState, TilePos, AdventureConfig } from './types';
import { DEFAULT_CONFIG } from './types';
import { Dungeon } from './dungeon';
import {
  drawSprite,
  HERO_IDLE_1, HERO_IDLE_2,
  HERO_WALK_1, HERO_WALK_2,
  HERO_ACTION, HERO_SIT,
  CAMPFIRE_1, CAMPFIRE_2,
  getEncounterSprites,
  getResolutionParticle,
  PALETTE,
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
  private dungeon: Dungeon;

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
  private walkProgress = 0; // 0-1 interpolation between tiles
  private encounterTimer = 0;
  private resolutionTimer = 0;

  // Idle state
  private idleTimer = 0;
  private isAtCampfire = false;
  private idleIntervalId: ReturnType<typeof setInterval> | null = null;

  // Hero micro-movement (sub-pixel idle drift)
  private microOffsetX = 0;
  private microOffsetY = 0;
  private microPhase = 0;

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

    // Initialize dungeon
    this.dungeon = new Dungeon(Date.now());

    // Start idle animation (low frequency)
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

    // If idle, start processing
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
      // Instantly add room and move hero
      this.dungeon.addBeat(skipped);
      this.dungeon.heroPos = { ...this.dungeon.heroTarget };
    }

    this.currentBeat = this.beatQueue.shift()!;
    this._tooltipText = this.buildTooltip(this.currentBeat);

    // Add room to dungeon
    this.dungeon.addBeat(this.currentBeat);

    // Start walking
    this.walkPath = this.dungeon.getPathToTarget();
    this.walkStep = 0;
    this.walkProgress = 0;
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
      const dt = (now - this.lastFrameTime) / 1000;
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
    // Higher frequency idle rendering (4fps) for visible micro-movement
    this.idleIntervalId = setInterval(() => {
      this.frameCount++;
      this.idleTimer += 0.25;
      this.microPhase += 0.15;

      // Subtle breathing/fidget motion (1-2 pixel drift)
      this.microOffsetX = Math.sin(this.microPhase) * 1.5;
      this.microOffsetY = Math.sin(this.microPhase * 0.7 + 1.2) * 1.0;

      // Transition to campfire after 10 seconds of idle
      if (this.idleTimer > 20 && !this.isAtCampfire && !this._isBusy) {
        this.isAtCampfire = true;
      }

      this.render();
    }, 250);
  }

  private stopIdleLoop(): void {
    if (this.idleIntervalId !== null) {
      clearInterval(this.idleIntervalId);
      this.idleIntervalId = null;
    }
  }

  // ====== UPDATE ======

  private update(dt: number): void {
    this.frameCount++;
    this.stateTimer += dt;

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

    this.walkProgress += dt * 4; // tiles per second (slower = more visible movement)
    if (this.walkProgress >= 1) {
      this.walkProgress = 0;
      this.dungeon.heroPos = this.walkPath[this.walkStep];
      this.walkStep++;

      if (this.walkStep >= this.walkPath.length) {
        this.dungeon.heroPos = { ...this.dungeon.heroTarget };
        this.transitionTo('encounter');
      }
    }
  }

  private updateEncounter(_dt: number): void {
    this.encounterTimer++;
    // Encounter animation lasts ~60 frames (~1 second at 60fps)
    if (this.encounterTimer > 60) {
      this.transitionTo('resolution');
    }
  }

  private updateResolution(_dt: number): void {
    this.resolutionTimer++;
    // Resolution lasts ~30 frames (~0.5 seconds)
    if (this.resolutionTimer > 30) {
      this.processNextBeat();
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 30 * dt; // gravity
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

    const { pixelScale, tileSize } = this.config;
    const tilePx = tileSize * pixelScale;
    const heroScreenX = this.dungeon.heroPos.x * tilePx - this.dungeon.cameraX;
    const heroScreenY = this.dungeon.heroPos.y * tilePx - this.dungeon.cameraY;

    for (let i = 0; i < 5; i++) {
      this.particles.push({
        x: heroScreenX + tilePx / 2,
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
    const { canvasWidth, canvasHeight, pixelScale, tileSize } = this.config;
    const ctx = this.ctx;

    // Clear canvas with dark background
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Update camera
    this.dungeon.updateCamera(canvasWidth, canvasHeight, pixelScale, tileSize);

    // Render dungeon tiles
    this.dungeon.renderTiles(ctx, canvasWidth, canvasHeight, pixelScale, tileSize, this.frameCount);

    // Render encounter object (if in encounter/resolution state)
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
    const { pixelScale, tileSize } = this.config;
    const tilePx = tileSize * pixelScale;

    let heroX: number;
    let heroY: number;

    if (this.state === 'walking' && this.walkPath.length > 0 && this.walkStep < this.walkPath.length) {
      // Interpolate between current position and next path tile
      const from = this.walkStep > 0 ? this.walkPath[this.walkStep - 1] : this.dungeon.heroPos;
      const to = this.walkPath[this.walkStep];
      heroX = (from.x + (to.x - from.x) * this.walkProgress) * tilePx - this.dungeon.cameraX;
      heroY = (from.y + (to.y - from.y) * this.walkProgress) * tilePx - this.dungeon.cameraY;
    } else {
      heroX = this.dungeon.heroPos.x * tilePx - this.dungeon.cameraX;
      heroY = this.dungeon.heroPos.y * tilePx - this.dungeon.cameraY;
    }

    // Apply idle micro-movement offset (subtle breathing/fidget)
    if (this.state === 'idle' || this.state === 'encounter') {
      heroX += this.microOffsetX;
      heroY += this.microOffsetY;
    }

    let sprite: SpriteFrame;
    switch (this.state) {
      case 'walking':
        sprite = Math.floor(this.frameCount / 8) % 2 === 0 ? HERO_WALK_1 : HERO_WALK_2;
        break;
      case 'encounter':
        sprite = HERO_ACTION;
        break;
      case 'idle':
        if (this.isAtCampfire) {
          sprite = HERO_SIT;
        } else {
          sprite = Math.floor(this.frameCount / 4) % 2 === 0 ? HERO_IDLE_1 : HERO_IDLE_2;
        }
        break;
      default:
        sprite = HERO_IDLE_1;
    }

    drawSprite(this.ctx, sprite, heroX, heroY, pixelScale);
  }

  private renderEncounter(): void {
    if (!this.currentBeat) return;
    const { pixelScale, tileSize } = this.config;
    const tilePx = tileSize * pixelScale;

    const sprites = getEncounterSprites(this.currentBeat.beat);
    if (sprites.length === 0) return;

    // Place encounter one tile to the right of hero
    const encounterX = this.dungeon.heroTarget.x * tilePx - this.dungeon.cameraX + tilePx;
    const encounterY = this.dungeon.heroTarget.y * tilePx - this.dungeon.cameraY;

    const frameIdx = sprites.length > 1
      ? Math.floor(this.frameCount / 15) % sprites.length
      : 0;

    drawSprite(this.ctx, sprites[frameIdx], encounterX, encounterY, pixelScale);
  }

  private renderCampfire(): void {
    const { pixelScale, tileSize } = this.config;
    const tilePx = tileSize * pixelScale;

    // Place campfire one tile to the right of hero
    const cfX = this.dungeon.heroPos.x * tilePx - this.dungeon.cameraX + tilePx;
    const cfY = this.dungeon.heroPos.y * tilePx - this.dungeon.cameraY;

    const sprite = Math.floor(this.frameCount / 3) % 2 === 0 ? CAMPFIRE_1 : CAMPFIRE_2;
    drawSprite(this.ctx, sprite, cfX, cfY, pixelScale);
  }

  private renderParticles(): void {
    const { pixelScale } = this.config;
    for (const p of this.particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      this.ctx.globalAlpha = alpha;
      drawSprite(this.ctx, p.sprite, p.x, p.y, pixelScale);
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
