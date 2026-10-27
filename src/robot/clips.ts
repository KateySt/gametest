// Robot animation clips: pure data, no three.js. A clip says what the body
// should do at each moment; RobotRig follows it with springs, so clips can
// switch at any time without popping.

/** Arm angles (right arm raises with +, left with −), head tilt, body squash. */
export interface PoseFrame {
  l: number;
  r: number;
  headZ: number;
  headY: number;
  /** Added to the squash/stretch target: negative = crouch, positive = stretch. */
  squash?: number;
  /** Body lean (radians, + leans left). */
  lean?: number;
  happy?: boolean;
}

/** One-shot body impulse fired when the clip reaches `at` (0..1). */
export interface ClipEvent {
  at: number;
  /** Hop velocity in robot heights per second. */
  jump?: number;
  /** Full 360° turn. */
  spin?: boolean;
  /** Jiggle kick, negative squashes. */
  jiggle?: number;
  /** Antenna flick strength. */
  antenna?: number;
}

export interface RobotClip {
  /** Milliseconds; `Infinity` loops. */
  duration: number;
  /** progress 0..1 (0 for looping clips), t = seconds for oscillations. */
  frame(progress: number, t: number): PoseFrame;
  events?: ClipEvent[];
}

export type ClipName =
  | "idle"
  // fidgets: small "I'm alive" gestures at home
  | "lookAround"
  | "stretch"
  | "hop"
  // attention seeking when the player is idle (once per idle period)
  | "dream"
  | "wave"
  | "tease"
  // game reactions
  | "pullLever"
  | "spinStart"
  | "smallWin"
  | "win"
  | "bigWin";

export const FIDGETS: readonly ClipName[] = ["lookAround", "stretch", "hop"];

const smooth = (edge0: number, edge1: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return k * k * (3 - 2 * k);
};
/** 0 → 1 → 0 over the clip with soft in/out. */
const bell = (p: number, inEnd = 0.2, outStart = 0.8) =>
  smooth(0, inEnd, p) * (1 - smooth(outStart, 1, p));

const rest = (t: number): PoseFrame => ({
  l: -0.08 - Math.sin(t * 1.6) * 0.06,
  r: 0.08 + Math.sin(t * 1.6 + 1) * 0.06,
  headZ: Math.sin(t * 0.7) * 0.04,
  headY: 0,
});

const cheer = (t: number, speed: number): PoseFrame => ({
  l: -2.2 - Math.sin(t * speed) * 0.35,
  r: 2.2 + Math.sin(t * speed + 1) * 0.35,
  headZ: Math.sin(t * speed * 0.5) * 0.1,
  headY: 0,
  happy: true,
});

// The robot's home is to the RIGHT of the lever, so it reaches with its left arm (−).
export const CLIPS: Record<ClipName, RobotClip> = {
  idle: { duration: Infinity, frame: (_p, t) => rest(t) },

  // --- fidgets ---
  lookAround: {
    duration: 1800,
    frame: (p, t) => ({
      ...rest(t),
      headY: Math.sin(p * Math.PI * 2) * 0.55 * bell(p),
      headZ: Math.sin(p * Math.PI * 2) * 0.08,
    }),
  },
  stretch: {
    duration: 1600,
    frame: (p, t) => {
      const up = bell(p, 0.35, 0.7);
      return {
        l: -0.1 - up * 2.4,
        r: 0.1 + up * 2.4,
        headZ: Math.sin(t * 2) * 0.03,
        headY: 0,
        squash: up * 0.12,
        happy: up > 0.6,
      };
    },
    events: [{ at: 0.75, jiggle: -3 }],
  },
  hop: {
    duration: 1000,
    frame: (_p, t) => rest(t),
    events: [
      { at: 0, jump: 1.2, jiggle: 3 },
      { at: 0.1, antenna: 10 },
    ],
  },

  // --- attention seeking ---
  dream: {
    duration: 3400,
    // dreamy: head tilted towards the bubble, hands together, happy squint
    frame: (p, t) => {
      const on = bell(p, 0.12, 0.85);
      return {
        l: -0.1 - on * 0.9,
        r: 0.1 + on * 0.9,
        headZ: on * (0.2 + Math.sin(t * 1.3) * 0.05),
        headY: on * 0.25,
        lean: on * 0.08,
        happy: on > 0.4,
      };
    },
  },
  wave: {
    duration: 2600,
    frame: (p, t) => {
      const on = bell(p, 0.12, 0.85);
      return {
        l: -0.15,
        r: 0.08 + on * (2.07 + Math.sin(t * 9) * 0.4),
        headZ: -0.08 * on,
        headY: 0,
        happy: on > 0.5,
      };
    },
  },
  tease: {
    duration: 3200,
    // hand on the knob, little tugs, glancing at the player
    frame: (p, t) => {
      const hold = bell(p, 0.12, 0.88);
      return {
        l: -0.1 - hold * (1.45 + Math.max(0, Math.sin(t * 7)) * 0.25),
        r: 0.08,
        headZ: hold * 0.08,
        headY: hold * (p < 0.5 ? 0.35 : -0.15),
        lean: hold * 0.12,
      };
    },
  },

  // --- game reactions ---
  pullLever: {
    duration: 700,
    // reach the knob, yank it down with the lever, let go
    frame: (p, t) => {
      const reach = 1 - smooth(0.12, 0.35, p);
      const dip = bell(p, 0.25, 0.55);
      return {
        l: -0.3 - reach * 1.3 - (1 - smooth(0.6, 1, p)) * 0.2,
        r: 0.1 + dip * 0.6,
        headZ: Math.sin(t * 14) * 0.03,
        headY: 0.2,
        squash: -0.22 * dip,
        lean: 0.18 * dip,
        happy: p > 0.4,
      };
    },
    events: [{ at: 0.3, jiggle: -4, antenna: 12 }],
  },
  spinStart: {
    duration: 900,
    // "Let's go!": crouch, push both arms at the reels with a hop
    frame: (p, t) => {
      const push = smooth(0.3, 0.45, p) * (1 - smooth(0.7, 1, p));
      const crouch = smooth(0, 0.25, p) * (1 - smooth(0.3, 0.4, p));
      return {
        l: -0.1 + crouch * 0.35 - push * 1.5,
        r: 0.1 - crouch * 0.35 + push * 1.5,
        headZ: Math.sin(t * 14) * 0.05 * push,
        headY: 0,
        squash: -0.28 * crouch,
        happy: push > 0.5,
      };
    },
    events: [{ at: 0.35, jump: 1.3, jiggle: 4 }],
  },
  smallWin: {
    duration: 1300,
    // happy clap
    frame: (p, t) => {
      const on = bell(p, 0.1, 0.85);
      const clap = Math.abs(Math.sin(t * 11));
      return {
        l: -0.1 - on * (0.9 + clap * 0.35),
        r: 0.1 + on * (0.9 + clap * 0.35),
        headZ: Math.sin(t * 6) * 0.06 * on,
        headY: 0,
        happy: true,
      };
    },
    events: [{ at: 0, jiggle: 3, antenna: 8 }],
  },
  win: {
    duration: 1600,
    frame: (_p, t) => cheer(t, 10),
    events: [{ at: 0, jump: 2.2, jiggle: 5 }],
  },
  bigWin: {
    duration: 2800,
    frame: (_p, t) => cheer(t, 13),
    events: [
      { at: 0, jump: 2.6, spin: true, jiggle: 5 },
      { at: 0.55, jump: 2, jiggle: 4, antenna: 14 },
    ],
  },
};
