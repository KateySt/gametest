import { SYMBOL_IDS, type SymbolId } from "../config/slotConfig";
import { StateMachine } from "../core/StateMachine";
import { type Random } from "../core/rng";
import { CLIPS, FIDGETS, type ClipName } from "./clips";

// Pure behaviour logic: no three.js, no Pixi. It decides WHICH clip plays,
// WHERE the robot looks and WHAT it dreams of; RobotRig makes it move.
//
// The robot lives at one home spot next to the lever and only moves with a
// purpose — constant wandering pulls the eye away from the reels.
//
//   idle ──spin──▶ pullLever | spinStart ──▶ idle (watching each reel stop)
//   idle | spin clip ──win──▶ smallWin | win | bigWin ──▶ idle
//   a loss changes nothing
//
// Idle layers: breathing/gaze (always) · a random fidget every 8–15 s ·
// attention seeking once per idle period: dream (10 s) → wave (20 s) → tease the lever (25 s).

type State = "idle" | "spin" | "win";

const TRANSITIONS: Record<State, readonly State[]> = {
  idle: ["spin", "win"],
  spin: ["idle", "win"],
  win: ["idle", "spin"],
};

export interface Point {
  x: number;
  y: number;
}

/** Where things are, in design coordinates. */
export interface RobotLayout {
  home: Point;
  /** Robot height in design px. */
  size: number;
  reelCenters: Point[];
  /** Where the dream bubble floats. */
  bubble: Point;
}

export interface RobotIntent {
  target: Point;
  size: number;
  clip: ClipName;
  /** When the current clip started (ms); a new value restarts the clip. */
  clipStartedAt: number;
  lookAt: Point | null;
  /** What the robot is dreaming of right now, or null. */
  dream: SymbolId | null;
}

const DREAM_AFTER_MS = 10_000;
const WAVE_AFTER_MS = 20_000;
const TEASE_AFTER_MS = 25_000;
const POINTER_FRESH_MS = 3000;
const SMALL_WIN_BETS = 8;
const BIG_WIN_BETS = 20;
/** Hearts and stars are the usual dreams; the jackpot is a rare one. */
const DREAMS: readonly SymbolId[] = [...SYMBOL_IDS, "heart", "star"];

export class RobotBrain {
  private readonly state = new StateMachine<State>("idle", TRANSITIONS);
  private lastActivity = 0;
  private pointer: Point | null = null;
  private pointerAt = -Infinity;
  private clip: ClipName = "idle";
  private clipStartedAt = 0;
  private held = false;
  private spinning = false;
  private reelsStopped = 0;
  private nextFidgetAt = 8000;
  private lastFidget: ClipName | null = null;
  private dream: SymbolId | null = null;
  private lastDream: SymbolId | null = null;
  // attention seeking happens once per idle period
  private dreamed = false;
  private waved = false;
  private teased = false;

  constructor(
    private readonly layout: RobotLayout,
    private readonly random: Random = Math.random,
  ) {}

  /** Any mouse move, click, key press or spin. Interrupts attention seeking. */
  onUserActivity(now: number, pointer?: Point): void {
    this.lastActivity = now;
    if (pointer) {
      this.pointer = pointer;
      this.pointerAt = now;
    }
    this.dreamed = this.waved = this.teased = false;
    if (
      this.clip === "dream" ||
      this.clip === "wave" ||
      this.clip === "tease"
    ) {
      this.setClip("idle", now);
    }
  }

  /** While the user holds or drags the robot it can't pull the lever. */
  setHeld(held: boolean, now: number): void {
    this.held = held;
    this.onUserActivity(now);
  }

  onSpinStart(now: number): void {
    this.onUserActivity(now);
    this.spinning = true;
    this.reelsStopped = 0;
    this.goTo("spin");
    this.setClip(this.held ? "spinStart" : "pullLever", now);
  }

  onReelStopped(): void {
    this.reelsStopped++;
  }

  onReelsStopped(now: number, totalWin: number, bet: number): void {
    this.spinning = false;
    if (totalWin <= 0) return; // a loss: keep doing whatever is on
    this.goTo("win");
    const bets = totalWin / bet;
    this.setClip(
      bets >= BIG_WIN_BETS
        ? "bigWin"
        : bets >= SMALL_WIN_BETS
          ? "win"
          : "smallWin",
      now,
    );
  }

  update(now: number, motion = true): RobotIntent {
    // A one-shot clip ends → back to resting idle.
    if (
      this.clip !== "idle" &&
      now - this.clipStartedAt >= CLIPS[this.clip].duration
    ) {
      if (this.state.state !== "idle") {
        this.state.transitionTo("idle");
        // let a reaction breathe before the next fidget
        this.nextFidgetAt = Math.max(this.nextFidgetAt, now + 5000);
      }
      this.setClip("idle", now);
    }

    if (this.state.state === "idle" && this.clip === "idle" && !this.spinning) {
      this.pickIdleClip(now, motion);
    }

    return {
      target: this.layout.home,
      size: this.layout.size,
      clip: this.clip,
      clipStartedAt: this.clipStartedAt,
      lookAt: this.lookTarget(now),
      dream: this.clip === "dream" ? this.dream : null,
    };
  }

  private pickIdleClip(now: number, motion: boolean): void {
    const idleFor = now - this.lastActivity;
    if (!this.dreamed && idleFor > DREAM_AFTER_MS) {
      this.dreamed = true;
      const choices = DREAMS.filter((symbol) => symbol !== this.lastDream);
      this.dream = choices[Math.floor(this.random() * choices.length)];
      this.lastDream = this.dream;
      this.setClip("dream", now);
    } else if (!this.waved && idleFor > WAVE_AFTER_MS) {
      this.waved = true;
      this.setClip("wave", now);
    } else if (!this.teased && idleFor > TEASE_AFTER_MS && !this.held) {
      this.teased = true;
      this.setClip("tease", now);
    } else if (motion && now > this.nextFidgetAt) {
      // never the same fidget twice in a row
      const choices = FIDGETS.filter((clip) => clip !== this.lastFidget);
      const fidget = choices[Math.floor(this.random() * choices.length)];
      this.lastFidget = fidget;
      this.nextFidgetAt = now + 8000 + this.random() * 7000;
      this.setClip(fidget, now);
    }
  }

  private lookTarget(now: number): Point | null {
    // While reels spin, follow them stopping left to right.
    if (this.spinning) {
      const { reelCenters } = this.layout;
      return reelCenters[Math.min(this.reelsStopped, reelCenters.length - 1)];
    }
    if (this.clip === "dream") return this.layout.bubble;
    if (this.clip === "tease" || this.clip === "pullLever") return null; // at the player
    // Otherwise: the user, if the pointer moved recently.
    return now - this.pointerAt < POINTER_FRESH_MS ? this.pointer : null;
  }

  private setClip(clip: ClipName, now: number): void {
    this.clip = clip;
    this.clipStartedAt = now;
  }

  private goTo(state: State): void {
    if (this.state.state !== state) this.state.transitionTo(state);
  }
}
