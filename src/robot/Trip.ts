import { type Point } from "./RobotBrain";

// One journey of the robot along the lane: a polyline through lane nodes
// with rounded corners, sampled by arc length, travelled with ease-in-out.
// Pure geometry — no three.js, no Pixi.

/** A lane node: where, and how big the robot may be there. */
export interface SizedPoint extends Point {
  size: number;
}

const CORNER_RADIUS = 42;
const SAMPLE_STEP = 6;
/** Design px per second at full speed. */
const SPEED = 340;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

export class Trip {
  private readonly samples: SizedPoint[] = [];
  /** Cumulative arc length at each sample. */
  private readonly lengths: number[] = [0];
  readonly duration: number;

  /**
   * @param nodes  lane nodes to pass through, first = where the robot is
   * @param tempo  1 = normal; > 1 faster (eager), < 1 lazier
   */
  constructor(
    nodes: readonly SizedPoint[],
    readonly startedAt: number,
    tempo = 1,
  ) {
    this.sample(nodes);
    const length = this.lengths[this.lengths.length - 1];
    this.duration = Math.min(
      2800,
      Math.max(700, (length / (SPEED * tempo)) * 1000),
    );
  }

  isDone(now: number): boolean {
    return now - this.startedAt >= this.duration;
  }

  /** Position, size and a point slightly ahead (to look where it's going). */
  at(now: number): { position: Point; size: number; ahead: Point } {
    const t = Math.min(1, Math.max(0, (now - this.startedAt) / this.duration));
    const total = this.lengths[this.lengths.length - 1];
    const distance = easeInOutSine(t) * total;
    const here = this.pointAt(distance);
    return {
      position: { x: here.x, y: here.y },
      // Size follows the lane locally (bigger only out in the side margins),
      // never interpolated across the whole trip.
      size: here.size,
      ahead: this.pointAt(Math.min(total, distance + 120)),
    };
  }

  private pointAt(distance: number): SizedPoint {
    // binary search in the cumulative lengths
    let low = 0;
    let high = this.lengths.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.lengths[mid] < distance) low = mid + 1;
      else high = mid;
    }
    if (low === 0) return this.samples[0];
    const span = this.lengths[low] - this.lengths[low - 1] || 1;
    const k = (distance - this.lengths[low - 1]) / span;
    const a = this.samples[low - 1];
    const b = this.samples[low];
    return {
      x: lerp(a.x, b.x, k),
      y: lerp(a.y, b.y, k),
      size: lerp(a.size, b.size, k),
    };
  }

  /** Straight segments + a quadratic curve at every inner node (rounded corner). */
  private sample(nodes: readonly SizedPoint[]): void {
    const push = (point: SizedPoint) => {
      const last = this.samples[this.samples.length - 1];
      if (last) {
        this.lengths.push(
          this.lengths[this.lengths.length - 1] +
            Math.hypot(point.x - last.x, point.y - last.y),
        );
      }
      this.samples.push(point);
    };
    const line = (a: SizedPoint, b: SizedPoint) => {
      const steps = Math.max(
        1,
        Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / SAMPLE_STEP),
      );
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        push({
          x: lerp(a.x, b.x, t),
          y: lerp(a.y, b.y, t),
          size: lerp(a.size, b.size, t),
        });
      }
    };

    push(nodes[0]);
    let from = nodes[0];
    for (let i = 1; i < nodes.length - 1; i++) {
      const corner = nodes[i];
      const before = nodes[i - 1];
      const after = nodes[i + 1];
      const inLength = Math.hypot(corner.x - before.x, corner.y - before.y);
      const outLength = Math.hypot(after.x - corner.x, after.y - corner.y);
      const r = Math.min(CORNER_RADIUS, inLength / 2, outLength / 2);
      const entry = {
        x: corner.x - ((corner.x - before.x) / (inLength || 1)) * r,
        y: corner.y - ((corner.y - before.y) / (inLength || 1)) * r,
        size: corner.size,
      };
      const exit = {
        x: corner.x + ((after.x - corner.x) / (outLength || 1)) * r,
        y: corner.y + ((after.y - corner.y) / (outLength || 1)) * r,
        size: corner.size,
      };
      line(from, entry);
      for (let s = 1; s <= 8; s++) {
        const t = s / 8;
        push({
          x:
            (1 - t) ** 2 * entry.x +
            2 * (1 - t) * t * corner.x +
            t ** 2 * exit.x,
          y:
            (1 - t) ** 2 * entry.y +
            2 * (1 - t) * t * corner.y +
            t ** 2 * exit.y,
          size: corner.size,
        });
      }
      from = exit;
    }
    line(from, nodes[nodes.length - 1]);
  }
}
