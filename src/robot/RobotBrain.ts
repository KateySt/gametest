import { SYMBOL_IDS, type SymbolId } from "../config/slotConfig";
import { StateMachine } from "../core/StateMachine";
import { type Random } from "../core/rng";
import { CLIPS, FIDGETS, type ClipName } from "./clips";
import { Trip } from "./Trip";

// Pure behaviour logic: no three.js, no Pixi. It decides WHERE the robot
// goes, WHICH clip plays, WHERE it looks and WHAT it dreams of; RobotRig
// makes it move.
//
// The robot rests at spots around the machine and makes TRIPS between them
// along a U-shaped lane outside the card (beside SPIN → up the left side →
// across the top → down the right side → beside SPIN), with rounded corners
// and ease-in-out, so it never cuts across the reels.
//
// Where it goes: towards the player's cursor (after the cursor settles, with
// hysteresis), otherwise a lazy wander after a random 6–14 s wait — mostly
// to a near spot, never straight back, sometimes pausing at a corner to look
// around. Never a fixed loop.
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
  /** On a trip: the rig follows the path tightly instead of springing loosely. */
  travelling: boolean;
}

interface Node extends Point {
  size: number;
  /** A spot the robot may stop at (others are corners it only passes). */
  rest: boolean;
}

const SIZE = 165;
const SIZE_WIDE = 200;
/** Minimum rest after a trip before following the cursor again. */
const DWELL_MS = 2500;
/** The cursor must point at the same spot this long before the robot goes. */
const CURSOR_SETTLE_MS = 700;
/** Only move if the new spot is this much closer to the cursor. */
const CURSOR_HYSTERESIS_PX = 80;
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
  // movement: rest at `at`, or travel on `trip` towards `tripGoal`
  private at = TOP_CENTRE;
  private trip: Trip | null = null;
  private tripGoal = TOP_CENTRE;
  /** Further legs after the current trip (a pause at a corner splits a trip). */
  private queue: number[] = [];
  private pauseUntil = 0;
  private arrivedAt = 0;
  private cameFrom = -1;
  private nextWanderAt = 5000;
  private candidate = -1;
  private candidateSince = 0;
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

  /** @param visible  visible area in design coordinates (wide screens get outer lanes) */
  update(now: number, visible: Rect, motion = true): RobotIntent {
    const lane = this.laneFor(visible);

    // A one-shot clip ends → back to resting idle.
    if (
      this.clip !== "idle" &&
      now - this.clipStartedAt >= CLIPS[this.clip].duration
    ) {
      if (this.state.state !== "idle") {
        this.state.transitionTo("idle");
        // let a reaction breathe before the next fidget or wander
        this.nextFidgetAt = Math.max(this.nextFidgetAt, now + 5000);
        this.nextWanderAt = Math.max(this.nextWanderAt, now + 4000);
      }
      this.setClip("idle", now);
    }

    // Trips: arrive, maybe pause at a corner, continue with the next leg.
    if (this.trip?.isDone(now)) {
      this.cameFrom = this.at;
      this.at = this.tripGoal;
      this.trip = null;
      this.arrivedAt = now;
      this.nextWanderAt = now + 6000 + this.random() * 8000;
      if (this.queue.length > 0) {
        this.pauseUntil = now + 1100 + this.random() * 500;
        if (this.clip === "idle") this.setClip("lookAround", now);
      }
    }
    if (
      !this.trip &&
      this.queue.length > 0 &&
      now >= this.pauseUntil &&
      !this.held
    ) {
      this.startTrip(this.queue.shift()!, now, lane, 1);
    }

    if (this.state.state === "idle" && !this.spinning) {
      this.planIdle(now, motion, lane);
    }

    const travel = this.trip?.at(now);
    const rest = lane[this.at];
    return {
      target: travel?.position ?? { x: rest.x, y: rest.y },
      size: travel?.size ?? rest.size,
      clip: this.clip,
      clipStartedAt: this.clipStartedAt,
      lookAt: this.lookTarget(now, lane, travel?.ahead),
      dream:
        this.clip === "dream" && this.dreamOf
          ? { symbol: this.dreamOf, bubble: this.bubbleSpot(lane) }
          : null,
      travelling: !!this.trip,
    };
  }

  private planIdle(now: number, motion: boolean, lane: Node[]): void {
    const moving = !!this.trip || this.queue.length > 0;
    // An attention clip starts once the robot has reached its spot.
    if (this.pending && !moving) {
      this.setClip(this.pending, now);
      this.pending = null;
      return;
    }
    if (this.clip !== "idle" || this.pending || moving || this.held) return;

    const idleFor = now - this.lastActivity;
    if (!this.dreamed && idleFor > DREAM_AFTER_MS) {
      // dream at the nearer top corner: the bubble fits in the band above the reels
      this.dreamed = true;
      const choices = DREAMS.filter((symbol) => symbol !== this.lastDream);
      this.dreamOf = choices[Math.floor(this.random() * choices.length)];
      this.lastDream = this.dreamOf;
      this.travelTo(
        this.at <= TOP_CENTRE ? TOP_LEFT : TOP_RIGHT,
        now,
        lane,
        motion,
      );
      this.pending = "dream";
    } else if (!this.waved && idleFor > WAVE_AFTER_MS) {
      this.waved = true;
      this.pending = "wave"; // in place
    } else if (!this.pointed && idleFor > POINT_AFTER_MS) {
      this.pointed = true;
      this.travelTo(BESIDE_SPIN_RIGHT, now, lane, motion);
      this.pending = "point";
    } else if (motion && this.followCursor(now, lane)) {
      // started a trip towards the player
    } else if (
      motion &&
      now > this.nextWanderAt &&
      now - this.pointerAt >= POINTER_FRESH_MS
    ) {
      this.wander(now, lane);
    } else if (motion && now > this.nextFidgetAt) {
      // never the same fidget twice in a row
      const choices = FIDGETS.filter((clip) => clip !== this.lastFidget);
      const fidget = choices[Math.floor(this.random() * choices.length)];
      this.lastFidget = fidget;
      this.nextFidgetAt = now + 8000 + this.random() * 7000;
      this.setClip(fidget, now);
    }
  }

  /** Come closer to where the player is — once the cursor has settled. */
  private followCursor(now: number, lane: Node[]): boolean {
    if (!this.pointer || now - this.pointerAt >= POINTER_FRESH_MS) return false;
    if (now - this.arrivedAt < DWELL_MS) return false;
    const pointer = this.pointer;
    const distance = (index: number) =>
      Math.hypot(lane[index].x - pointer.x, lane[index].y - pointer.y);
    let best = this.at;
    lane.forEach((node, index) => {
      if (node.rest && distance(index) < distance(best)) best = index;
    });
    if (
      best === this.at ||
      distance(best) + CURSOR_HYSTERESIS_PX > distance(this.at)
    ) {
      this.candidate = -1;
      return false;
    }
    if (best !== this.candidate) {
      this.candidate = best;
      this.candidateSince = now;
      return false;
    }
    if (now - this.candidateSince < CURSOR_SETTLE_MS) return false;
    this.candidate = -1;
    this.startTrip(best, now, lane, 1.25); // a bit eager
    return true;
  }

  /** Lazy wander: mostly a near spot, never straight back, sometimes a corner pause. */
  private wander(now: number, lane: Node[]): void {
    const options = lane
      .map((node, index) => ({ node, index }))
      .filter(
        ({ node, index }) =>
          node.rest && index !== this.at && index !== this.cameFrom,
      );
    if (options.length === 0) return;
    const weights = options.map(({ index }) =>
      Math.abs(index - this.at) <= 2 ? 3 : 1,
    );
    let roll = this.random() * weights.reduce((sum, w) => sum + w, 0);
    const pick = options.find((_, i) => (roll -= weights[i]) < 0) ?? options[0];

    // Passing a corner? Sometimes stop there for a look around.
    const step = Math.sign(pick.index - this.at);
    const corners: number[] = [];
    for (let i = this.at + step; i !== pick.index; i += step) {
      if (!lane[i].rest) corners.push(i);
    }
    if (corners.length > 0 && this.random() < 0.3) {
      this.queue = [pick.index];
      this.startTrip(corners[0], now, lane, 0.9);
    } else {
      this.startTrip(pick.index, now, lane, 0.8 + this.random() * 0.4);
    }
  }

  /** Trip (or a jump cut with reduced motion) to a lane node. */
  private travelTo(
    goal: number,
    now: number,
    lane: Node[],
    motion: boolean,
  ): void {
    this.queue = [];
    if (!motion) {
      this.at = goal;
      return;
    }
    this.startTrip(goal, now, lane, 1);
  }

  private startTrip(
    goal: number,
    now: number,
    lane: Node[],
    tempo: number,
  ): void {
    if (goal === this.at) return;
    const step = Math.sign(goal - this.at);
    const nodes: Node[] = [];
    for (let i = this.at; i !== goal + step; i += step) nodes.push(lane[i]);
    this.trip = new Trip(nodes, now, tempo);
    this.tripGoal = goal;
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

  private lookTarget(now: number, lane: Node[], ahead?: Point): Point | null {
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
    if (now - this.pointerAt < POINTER_FRESH_MS) return this.pointer;
    return ahead ?? null; // travelling: look where it's going
  }

  private setClip(clip: ClipName, now: number): void {
    this.clip = clip;
    this.clipStartedAt = now;
  }

  private goTo(state: State): void {
    if (this.state.state !== state) this.state.transitionTo(state);
  }
}
