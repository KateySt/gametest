import { SYMBOL_IDS, type SymbolId } from "../config/slotConfig";
import { StateMachine } from "../core/StateMachine";
import { type Random } from "../core/rng";
import { CLIPS, FIDGETS, type ClipName } from "./clips";

// Pure behaviour logic: no three.js, no Pixi. It decides WHERE the robot
// goes, WHICH clip plays, WHERE it looks and WHAT it dreams of; RobotRig
// makes it move.
//
// The robot drifts between rest spots around the machine, always travelling
// along a U-shaped lane outside the card (beside SPIN → up the left side →
// across the top → down the right side → beside SPIN). It never cuts across
// the reels, so the play area is never covered.
//
//   idle ──spin──▶ spinStart ──▶ idle (watching each reel stop)
//   idle | spin ──win──▶ smallWin | win | bigWin ──▶ idle        a loss changes nothing
//
// Idle: breathing/gaze always · fidgets at rest · once per idle period:
// dream (10 s, at a top corner) → wave (20 s) → point at SPIN (25 s).

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

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where things are, in design coordinates. */
export interface RobotLayout {
  /** The machine card (outer edge). */
  frame: Rect;
  /** The reels themselves — the robot must never stand on them. */
  reelWindow: Rect;
  button: Rect;
  reelCenters: Point[];
}

export interface RobotIntent {
  target: Point;
  size: number;
  clip: ClipName;
  /** When the current clip started (ms); a new value restarts the clip. */
  clipStartedAt: number;
  lookAt: Point | null;
  /** What the robot dreams of right now (and where the bubble goes), or null. */
  dream: { symbol: SymbolId; bubble: Point } | null;
}

interface Node extends Point {
  size: number;
  /** A spot the robot may stop at (others are corners it only passes). */
  rest: boolean;
}

const SIZE = 165;
const SIZE_WIDE = 200;
// Small, so the robot really turns at corners instead of cutting across them.
const ARRIVED_PX = 14;
const DREAM_AFTER_MS = 10_000;
const WAVE_AFTER_MS = 20_000;
const POINT_AFTER_MS = 25_000;
const POINTER_FRESH_MS = 3000;
const SMALL_WIN_BETS = 8;
const BIG_WIN_BETS = 20;
/** Hearts and stars are the usual dreams; the jackpot is a rare one. */
const DREAMS: readonly SymbolId[] = [...SYMBOL_IDS, "heart", "star"];
const ATTENTION: ReadonlySet<ClipName> = new Set(["dream", "wave", "point"]);

// Lane node indices (fixed order, so a path is just ±1 steps).
const TOP_LEFT = 5;
const TOP_CENTRE = 6;
const TOP_RIGHT = 7;
const BESIDE_SPIN_RIGHT = 12;

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
  // movement along the lane
  private at = TOP_CENTRE;
  private goal = TOP_CENTRE;
  private nextHopAt = 3000;
  // idle schedule
  private nextFidgetAt = 9000;
  private lastFidget: ClipName | null = null;
  private dreamOf: SymbolId | null = null;
  private lastDream: SymbolId | null = null;
  private dreamed = false;
  private waved = false;
  private pointed = false;
  /** Attention clip waiting for the robot to reach its spot. */
  private pending: ClipName | null = null;

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
    this.dreamed = this.waved = this.pointed = false;
    this.pending = null;
    if (ATTENTION.has(this.clip)) this.setClip("idle", now);
  }

  /** While the user holds or drags the robot it stays where it is. */
  setHeld(held: boolean, now: number): void {
    this.held = held;
    this.onUserActivity(now);
  }

  onSpinStart(now: number): void {
    this.onUserActivity(now);
    this.spinning = true;
    this.reelsStopped = 0;
    this.goTo("spin");
    this.setClip("spinStart", now);
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

  /**
   * @param visible  visible area in design coordinates (wide screens get outer lanes)
   * @param position where the robot body is right now (from the rig)
   */
  update(
    now: number,
    visible: Rect,
    position: Point,
    motion = true,
  ): RobotIntent {
    const lane = this.laneFor(visible);

    // A one-shot clip ends → back to resting idle.
    if (
      this.clip !== "idle" &&
      now - this.clipStartedAt >= CLIPS[this.clip].duration
    ) {
      if (this.state.state !== "idle") {
        this.state.transitionTo("idle");
        // let a reaction breathe before the next fidget or drift
        this.nextFidgetAt = Math.max(this.nextFidgetAt, now + 5000);
        this.nextHopAt = Math.max(this.nextHopAt, now + 2500);
      }
      this.setClip("idle", now);
    }

    // Walk the lane one node at a time towards the goal.
    if (this.at !== this.goal && !this.held) {
      const step = Math.sign(this.goal - this.at);
      const next = lane[this.at + step];
      const distance = Math.hypot(next.x - position.x, next.y - position.y);
      if (!motion || distance < ARRIVED_PX) this.at += step;
    }
    const arrived = this.at === this.goal;
    const heading = arrived
      ? lane[this.at]
      : lane[this.at + Math.sign(this.goal - this.at)];

    if (this.state.state === "idle" && !this.spinning) {
      this.planIdle(now, arrived, motion, lane);
    }

    return {
      target: { x: heading.x, y: heading.y },
      size: heading.size,
      clip: this.clip,
      clipStartedAt: this.clipStartedAt,
      lookAt: this.lookTarget(now, lane),
      dream:
        this.clip === "dream" && this.dreamOf
          ? { symbol: this.dreamOf, bubble: this.bubbleSpot(lane) }
          : null,
    };
  }

  private planIdle(
    now: number,
    arrived: boolean,
    motion: boolean,
    lane: Node[],
  ): void {
    // An attention clip starts once the robot has reached its spot.
    if (this.pending && arrived) {
      this.setClip(this.pending, now);
      this.pending = null;
      return;
    }
    if (this.clip !== "idle" || this.pending) return;

    const idleFor = now - this.lastActivity;
    if (!this.dreamed && idleFor > DREAM_AFTER_MS) {
      // dream at the nearer top corner: the bubble fits in the band above the reels
      this.dreamed = true;
      const choices = DREAMS.filter((symbol) => symbol !== this.lastDream);
      this.dreamOf = choices[Math.floor(this.random() * choices.length)];
      this.lastDream = this.dreamOf;
      this.goal = this.at <= TOP_CENTRE ? TOP_LEFT : TOP_RIGHT;
      this.pending = "dream";
    } else if (!this.waved && idleFor > WAVE_AFTER_MS) {
      this.waved = true;
      this.goal = this.at; // in place
      this.pending = "wave";
    } else if (!this.pointed && idleFor > POINT_AFTER_MS) {
      this.pointed = true;
      this.goal = BESIDE_SPIN_RIGHT;
      this.pending = "point";
    } else if (arrived && motion && now > this.nextHopAt) {
      // drift to another rest spot along the lane
      const spots = lane
        .map((node, index) => ({ node, index }))
        .filter(({ node, index }) => node.rest && index !== this.at);
      this.goal = spots[Math.floor(this.random() * spots.length)].index;
      this.nextHopAt = now + 4500 + this.random() * 3500;
    } else if (arrived && motion && now > this.nextFidgetAt) {
      // never the same fidget twice in a row
      const choices = FIDGETS.filter((clip) => clip !== this.lastFidget);
      const fidget = choices[Math.floor(this.random() * choices.length)];
      this.lastFidget = fidget;
      this.nextFidgetAt = now + 8000 + this.random() * 7000;
      this.setClip(fidget, now);
    }
  }

  /**
   * The U-shaped lane outside the card. On narrow screens the side lanes hug
   * the card (the body may overlap the card's padding, never the reels); on
   * wide screens they move out into the letterbox margins.
   */
  private laneFor(visible: Rect): Node[] {
    const { frame, reelWindow, button } = this.layout;
    const wideLeft = visible.left < frame.left - SIZE_WIDE;
    const wideRight = visible.right > frame.right + SIZE_WIDE;
    const sideSize = (wide: boolean) => (wide ? SIZE_WIDE : SIZE);
    // the body's half-width is about 0.27 × size: keep it off the reel window
    const leftX = wideLeft
      ? frame.left - SIZE_WIDE * 0.55
      : reelWindow.left - SIZE * 0.32;
    const rightX = wideRight
      ? frame.right + SIZE_WIDE * 0.55
      : reelWindow.right + SIZE * 0.32;
    const topY = frame.top / 2;
    const buttonY = (button.top + button.bottom) / 2;
    const highY = reelWindow.top + 120;
    const lowY = reelWindow.bottom - 120;
    const node = (x: number, y: number, size: number, rest: boolean) => ({
      x,
      y,
      size,
      rest,
    });

    // Corners make every segment horizontal or vertical: no diagonal can
    // clip a corner of the reel window.
    return [
      node(button.left - SIZE * 0.36, buttonY, SIZE, true), // 0 beside SPIN, left
      node(leftX, buttonY, SIZE, false), // 1 corner
      node(leftX, lowY, sideSize(wideLeft), wideLeft), // 2
      node(leftX, highY, sideSize(wideLeft), wideLeft), // 3
      node(leftX, topY, SIZE, false), // 4 corner
      node(frame.left + 80, topY, SIZE, true), // 5 top left
      node((frame.left + frame.right) / 2, topY, SIZE, true), // 6 top centre
      node(frame.right - 80, topY, SIZE, true), // 7 top right
      node(rightX, topY, SIZE, false), // 8 corner
      node(rightX, highY, sideSize(wideRight), wideRight), // 9
      node(rightX, lowY, sideSize(wideRight), wideRight), // 10
      node(rightX, buttonY, SIZE, false), // 11 corner
      node(button.right + SIZE * 0.36, buttonY, SIZE, true), // 12 beside SPIN, right
    ];
  }

  /** The dream bubble floats in the band above the reels, beside the robot. */
  private bubbleSpot(lane: Node[]): Point {
    const robot = lane[this.at];
    const { frame } = this.layout;
    const towardsCentre = robot.x < (frame.left + frame.right) / 2 ? 1 : -1;
    return { x: robot.x + towardsCentre * 200, y: robot.y };
  }

  private lookTarget(now: number, lane: Node[]): Point | null {
    // While reels spin, follow them stopping left to right.
    if (this.spinning) {
      const { reelCenters } = this.layout;
      return reelCenters[Math.min(this.reelsStopped, reelCenters.length - 1)];
    }
    if (this.clip === "dream") return this.bubbleSpot(lane);
    if (this.clip === "point") {
      const { button } = this.layout;
      return {
        x: (button.left + button.right) / 2,
        y: (button.top + button.bottom) / 2,
      };
    }
    if (this.clip === "wave") return null; // at the player
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
