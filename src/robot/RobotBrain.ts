import { StateMachine } from "../core/StateMachine";
import { type Random } from "../core/rng";

// Pure behaviour logic: no three.js, no Pixi. It decides WHERE the robot
// wants to be, WHAT it does and WHERE it looks; RobotRig makes it move.

export type RobotPose = "idle" | "wave" | "point" | "think" | "cheer";

type Mood = "float" | "watch" | "cheer" | "sad" | "wave" | "point";

const MOODS: Record<Mood, readonly Mood[]> = {
  float: ["watch", "wave"],
  watch: ["cheer", "sad"],
  cheer: ["float", "watch"],
  sad: ["float", "watch"],
  wave: ["float", "point", "watch"],
  point: ["float", "watch"],
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
  pose: RobotPose;
  /** -1 robot is left of what it points at, 1 right. */
  side: -1 | 1;
  lookAt: Point | null;
  happy: boolean;
  /** Increments once per jump; the rig jumps when it changes. */
  jumpCount: number;
}

interface Spot extends Point {
  size: number;
}

const IDLE_WAVE_MS = 6000;
const IDLE_POINT_MS = 15000;
const POINTER_FRESH_MS = 3000;
const SMALL = 140;
const LARGE = 170;

export class RobotBrain {
  private readonly mood = new StateMachine<Mood>("float", MOODS, () => {
    this.moodSince = this.now;
  });
  private now = 0;
  private moodSince = 0;
  private lastActivity = 0;
  private pointer: Point | null = null;
  private pointerAt = -Infinity;
  private spot: Spot;
  private nextHopAt = 0;
  private happyUntil = 0;
  private jumpCount = 0;

  constructor(
    private readonly layout: RobotLayout,
    private readonly random: Random = Math.random,
  ) {
    this.spot = this.spotsFor(null)[0];
  }

  /** Any mouse move, click, key press or spin. */
  onUserActivity(now: number, pointer?: Point): void {
    this.now = now;
    this.lastActivity = now;
    if (pointer) {
      this.pointer = pointer;
      this.pointerAt = now;
    }
    if (this.is("wave") || this.is("point")) this.mood.transitionTo("float");
  }

  onSpinStart(now: number): void {
    this.onUserActivity(now);
    this.goTo("watch");
  }

  onReelsStopped(now: number, totalWin: number, bet: number): void {
    this.now = now;
    if (!this.is("watch")) return;
    if (totalWin > 0) {
      this.goTo("cheer");
      this.jumpCount++;
      this.happyUntil = now + (totalWin >= bet * 20 ? 2600 : 1400);
    } else {
      this.goTo("sad");
    }
  }

  onPoke(now: number): void {
    this.onUserActivity(now);
    this.happyUntil = now + 800;
  }

  onDoublePoke(now: number): void {
    this.onPoke(now);
    this.jumpCount++;
  }

  /** `motion: false` (prefers-reduced-motion): no wandering between spots. */
  update(now: number, visible: Rect, motion = true): RobotIntent {
    this.now = now;
    const idleFor = now - this.lastActivity;
    const inMood = now - this.moodSince;

    if (this.is("float") && idleFor > IDLE_WAVE_MS) this.goTo("wave");
    if (this.is("wave") && idleFor > IDLE_POINT_MS) this.goTo("point");
    if (this.is("cheer") && inMood > 2400) this.goTo("float");
    if (this.is("sad") && inMood > 1600) this.goTo("float");

    const spots = this.spotsFor(visible);
    const center = this.frameCenter();
    let pose: RobotPose = "idle";
    let lookAt: Point | null = null;

    switch (this.mood.state) {
      case "float":
        // Drift between the free spots around the machine.
        if (
          (motion && now > this.nextHopAt) ||
          !spots.some((s) => this.same(s, this.spot))
        ) {
          const others = spots.filter((s) => !this.same(s, this.spot));
          this.spot =
            others[Math.floor(this.random() * others.length)] ?? spots[0];
          this.nextHopAt = now + 4000 + this.random() * 3000;
        }
        break;
      case "watch":
        this.spot = this.topCenter();
        lookAt = center;
        break;
      case "cheer":
        this.spot = this.topCenter();
        pose = "cheer";
        break;
      case "sad":
        pose = "think";
        lookAt = center;
        break;
      case "wave":
        this.spot = this.nearest(spots, this.pointer ?? center);
        pose = "wave";
        break;
      case "point":
        this.spot = this.besideButton();
        pose = "point";
        lookAt = this.buttonCenter();
        break;
    }

    // A pointer that moved recently always wins: the robot watches the user.
    if (now - this.pointerAt < POINTER_FRESH_MS && pose !== "point") {
      lookAt = this.pointer;
    }

    return {
      target: { x: this.spot.x, y: this.spot.y },
      size: this.spot.size,
      pose,
      side: this.spot.x > this.buttonCenter().x ? 1 : -1,
      lookAt,
      happy: now < this.happyUntil,
      jumpCount: this.jumpCount,
    };
  }

  private is(mood: Mood): boolean {
    return this.mood.state === mood;
  }

  private goTo(mood: Mood): void {
    if (this.mood.state !== mood && this.mood.canTransitionTo(mood)) {
      this.mood.transitionTo(mood);
    }
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
