import { StateMachine } from "../core/StateMachine";
import { type Random } from "../core/rng";
import { CLIPS, type ClipName } from "./clips";

// Pure behaviour logic: no three.js, no Pixi. It decides WHERE the robot
// wants to be, WHICH clip plays and WHERE it looks; RobotRig makes it move.
//
//   idle ──spin──▶ spinStart (clip) ──▶ idle
//   idle | spinStart ──win──▶ win (clip) ──▶ idle        a loss changes nothing
//
// Idle has variations: float between spots → wave (6 s untouched) →
// point at SPIN (15 s untouched). Any user activity resets them.

type State = "idle" | "spinStart" | "win";

const TRANSITIONS: Record<State, readonly State[]> = {
  idle: ["spinStart", "win"],
  spinStart: ["idle", "win"],
  win: ["idle", "spinStart"],
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

/** Where the slot machine is, in design coordinates. */
export interface RobotLayout {
  frame: Rect;
  button: Rect;
}

export interface RobotIntent {
  /** Centre the robot wants to reach, design coordinates. */
  target: Point;
  /** Robot height in design px. */
  size: number;
  clip: ClipName;
  /** When the current clip started (ms); a new value restarts the clip. */
  clipStartedAt: number;
  /** -1 robot is left of what it points at, 1 right. */
  side: -1 | 1;
  lookAt: Point | null;
}

interface Spot extends Point {
  size: number;
}

const IDLE_WAVE_MS = 6000;
const IDLE_POINT_MS = 15000;
const POINTER_FRESH_MS = 3000;
const BIG_WIN_BETS = 20;
const SMALL = 140;
const LARGE = 170;

export class RobotBrain {
  private readonly state = new StateMachine<State>("idle", TRANSITIONS);
  private lastActivity = 0;
  private pointer: Point | null = null;
  private pointerAt = -Infinity;
  private spot: Spot;
  private nextHopAt = 0;
  private clip: ClipName = "idle";
  private clipStartedAt = 0;
  private held = false;

  constructor(
    private readonly layout: RobotLayout,
    private readonly random: Random = Math.random,
  ) {
    this.spot = this.spotsFor(null)[0];
  }

  /** Any mouse move, click, key press or spin. */
  onUserActivity(now: number, pointer?: Point): void {
    this.lastActivity = now;
    if (pointer) {
      this.pointer = pointer;
      this.pointerAt = now;
    }
  }

  /** While the user holds or drags the robot it stays at its spot. */
  setHeld(held: boolean, now: number): void {
    this.held = held;
    this.onUserActivity(now);
  }

  onSpinStart(now: number): void {
    this.onUserActivity(now);
    this.play("spinStart", now);
  }

  onReelsStopped(now: number, totalWin: number, bet: number): void {
    if (totalWin <= 0) return; // a loss: keep doing whatever idle/clip is on
    this.play(totalWin >= bet * BIG_WIN_BETS ? "bigWin" : "win", now);
  }

  /** `motion: false` (prefers-reduced-motion): no wandering between spots. */
  update(now: number, visible: Rect, motion = true): RobotIntent {
    const spots = this.spotsFor(visible);
    const center = this.frameCenter();
    let lookAt: Point | null = null;

    // A one-shot clip ends → back to idle.
    if (
      this.state.state !== "idle" &&
      now - this.clipStartedAt >= CLIPS[this.clip].duration
    ) {
      this.state.transitionTo("idle");
      this.clip = "idle";
      this.clipStartedAt = now;
      this.nextHopAt = now + 1500;
    }

    if (this.state.state === "idle") {
      const idleFor = now - this.lastActivity;
      const variation: ClipName =
        idleFor > IDLE_POINT_MS
          ? "point"
          : idleFor > IDLE_WAVE_MS
            ? "wave"
            : "idle";
      if (variation !== this.clip) {
        this.clip = variation;
        this.clipStartedAt = now;
      }

      if (variation === "point") {
        this.spot = this.besideButton();
        lookAt = this.buttonCenter();
      } else if (variation === "wave") {
        this.spot = this.nearest(spots, this.pointer ?? center);
      } else if (
        !this.held &&
        ((motion && now > this.nextHopAt) ||
          !spots.some((s) => this.same(s, this.spot)))
      ) {
        // Drift between the free spots around the machine.
        const others = spots.filter((s) => !this.same(s, this.spot));
        this.spot =
          others[Math.floor(this.random() * others.length)] ?? spots[0];
        this.nextHopAt = now + 4000 + this.random() * 3000;
      }
    } else if (this.state.state === "spinStart") {
      lookAt = center;
    }

    // A pointer that moved recently wins: the robot watches the user.
    if (now - this.pointerAt < POINTER_FRESH_MS && this.clip !== "point") {
      lookAt = this.pointer;
    }

    return {
      target: { x: this.spot.x, y: this.spot.y },
      size: this.spot.size,
      clip: this.clip,
      clipStartedAt: this.clipStartedAt,
      side: this.spot.x > this.buttonCenter().x ? 1 : -1,
      lookAt,
    };
  }

  private play(clip: "spinStart" | "win" | "bigWin", now: number): void {
    const next: State = clip === "spinStart" ? "spinStart" : "win";
    if (this.state.state !== next) this.state.transitionTo(next);
    this.clip = clip;
    this.clipStartedAt = now;
  }

  /**
   * Free spots: the band above the reels, beside the SPIN button, and —
   * on wide screens where the letterbox leaves room — outside the machine.
   */
  private spotsFor(visible: Rect | null): Spot[] {
    const { frame } = this.layout;
    const width = frame.right - frame.left;
    const spots: Spot[] = [
      { x: frame.left + width * 0.18, y: frame.top / 2, size: SMALL },
      this.topCenter(),
      { x: frame.right - width * 0.18, y: frame.top / 2, size: SMALL },
      this.besideButton(-1),
      this.besideButton(1),
    ];
    if (visible) {
      const outsideLeft = frame.left - LARGE * 0.75;
      const outsideRight = frame.right + LARGE * 0.75;
      for (const y of [frame.top + 140, frame.bottom - 140]) {
        if (outsideLeft - LARGE / 2 > visible.left)
          spots.push({ x: outsideLeft, y, size: LARGE });
        if (outsideRight + LARGE / 2 < visible.right)
          spots.push({ x: outsideRight, y, size: LARGE });
      }
    }
    return spots;
  }

  private topCenter(): Spot {
    const { frame } = this.layout;
    return { x: (frame.left + frame.right) / 2, y: frame.top / 2, size: SMALL };
  }

  private besideButton(side: -1 | 1 = 1): Spot {
    const { frame, button } = this.layout;
    const x =
      side > 0
        ? (button.right + frame.right) / 2
        : (frame.left + button.left) / 2;
    return { x, y: (button.top + button.bottom) / 2, size: SMALL };
  }

  private frameCenter(): Point {
    const { frame } = this.layout;
    return {
      x: (frame.left + frame.right) / 2,
      y: (frame.top + frame.bottom) / 2,
    };
  }

  private buttonCenter(): Point {
    const { button } = this.layout;
    return {
      x: (button.left + button.right) / 2,
      y: (button.top + button.bottom) / 2,
    };
  }

  private nearest(spots: Spot[], to: Point): Spot {
    let best = spots[0];
    let bestDistance = Infinity;
    for (const spot of spots) {
      const distance = Math.hypot(spot.x - to.x, spot.y - to.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = spot;
      }
    }
    return best;
  }

  private same(a: Spot, b: Spot): boolean {
    return Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
  }
}
