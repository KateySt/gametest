/** Damped spring: value + velocity. Slightly underdamped springs give the "jelly" lag. */
export interface Spring {
  x: number;
  v: number;
}

export const spring = (x = 0): Spring => ({ x, v: 0 });

/** Advance a spring towards `target` with stiffness `k` and damping `c`. */
export function stepSpring(
  value: Spring,
  target: number,
  k: number,
  c: number,
  dt: number,
): void {
  const acceleration = k * (target - value.x) - c * value.v;
  value.v += acceleration * dt;
  value.x += value.v * dt;
}

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
