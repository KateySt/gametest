/** Returns a float in [0, 1). Injected so tests can make spins deterministic. */
export type Random = () => number;

/** Small seeded PRNG (mulberry32). Good for gameplay and tests, NOT for real-money games. */
export function createSeededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickWeighted<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  random: Random,
): T {
  const totalWeight = items.reduce((sum, item) => sum + weightOf(item), 0);
  let roll = random() * totalWeight;
  for (const item of items) {
    roll -= weightOf(item);
    if (roll < 0) return item;
  }
  return items[items.length - 1];
}
