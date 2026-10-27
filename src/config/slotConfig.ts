// All tunable game data lives here: designers change numbers, not code.
// No pixi.js imports — this file is shared by the model, the view and tests.

// Ordered from most common to the jackpot.
export const SYMBOL_IDS = [
  "heart",
  "star",
  "macaron",
  "cloud",
  "crystal",
  "robot",
] as const;

export type SymbolId = (typeof SYMBOL_IDS)[number];

export interface SymbolDefinition {
  /** Relative chance to land on a cell. Higher = more common. */
  weight: number;
  /** Win multiplier of the bet for three in a row on a payline. */
  payout: number;
}

export const SYMBOLS: Record<SymbolId, SymbolDefinition> = {
  heart: { weight: 30, payout: 5 },
  star: { weight: 25, payout: 8 },
  macaron: { weight: 18, payout: 12 },
  cloud: { weight: 12, payout: 20 },
  crystal: { weight: 8, payout: 40 },
  robot: { weight: 5, payout: 100 }, // jackpot
};

export const REEL_COUNT = 3;
export const ROW_COUNT = 3;

/**
 * Each payline lists the row index to read on every reel, left to right.
 * Row 0 is the top row.
 */
export const PAYLINES: readonly (readonly number[])[] = [
  [1, 1, 1], // middle
  [0, 0, 0], // top
  [2, 2, 2], // bottom
  [0, 1, 2], // diagonal ↘
  [2, 1, 0], // diagonal ↗
];

export const STARTING_BALANCE = 1000;
export const BET = 10;
