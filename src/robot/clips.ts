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
}

export interface RobotClip {
  /** Milliseconds; `Infinity` loops (idle family). */
  duration: number;
  /** progress 0..1 (0 for looping clips), t = seconds for oscillations, side = -1|1. */
  frame(progress: number, t: number, side: number): PoseFrame;
  events?: ClipEvent[];
}

export type ClipName =
  "idle" | "wave" | "point" | "spinStart" | "win" | "bigWin";

const smooth = (edge0: number, edge1: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return k * k * (3 - 2 * k);
};

const cheer = (t: number, speed: number): PoseFrame => ({
  l: -2.2 - Math.sin(t * speed) * 0.35,
  r: 2.2 + Math.sin(t * speed + 1) * 0.35,
  headZ: Math.sin(t * speed * 0.5) * 0.1,
  headY: 0,
  happy: true,
});

export const CLIPS: Record<ClipName, RobotClip> = {
  // --- idle family: loops until something else happens ---
  idle: {
    duration: Infinity,
    frame: (_p, t) => ({
      l: -0.08 - Math.sin(t * 1.6) * 0.06,
      r: 0.08 + Math.sin(t * 1.6 + 1) * 0.06,
      headZ: Math.sin(t * 0.7) * 0.04,
      headY: 0,
    }),
  },
  wave: {
    duration: Infinity,
    frame: (_p, t) => ({
      l: -0.15,
      r: 2.15 + Math.sin(t * 9) * 0.4,
      headZ: -0.08,
      headY: 0,
    }),
  },
  point: {
    duration: Infinity,
    // point at the target, away from the robot's side
    frame: (_p, t, side) =>
      side > 0
        ? {
            l: -1.55 + Math.sin(t * 4) * 0.08,
            r: 0.1,
            headZ: 0.06,
            headY: -0.35,
          }
        : {
            l: -0.1,
            r: 1.55 + Math.sin(t * 4) * 0.08,
            headZ: -0.06,
            headY: 0.35,
          },
  },

  // --- "Let's go!": crouch, push both arms at the reels with a hop ---
  spinStart: {
    duration: 900,
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

  // --- wins: jump and cheer, then back to idle ---
  win: {
    duration: 1600,
    frame: (_p, t) => cheer(t, 10),
    events: [{ at: 0, jump: 2.4, jiggle: 5 }],
  },
  bigWin: {
    duration: 2800,
    frame: (_p, t) => cheer(t, 13),
    events: [
      { at: 0, jump: 2.6, spin: true, jiggle: 5 },
      { at: 0.55, jump: 2, jiggle: 4 },
    ],
  },
};
