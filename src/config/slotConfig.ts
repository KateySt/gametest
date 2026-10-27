// All tunable game data lives here: designers change numbers, not code.
// No pixi.js imports — this file is shared by the model, the view and tests.

export const SYMBOL_IDS = [
  "cherry",
  "lemon",
  "bell",
  "star",
  "seven",
  "diamond",
] as const;

export type SymbolId = (typeof SYMBOL_IDS)[number];

export interface SymbolDefinition {
  /** Relative chance to land on a cell. Higher = more common. */
  weight: number;
  /** Win multiplier of the bet for three in a row on a payline. */
  payout: number;
  /** Placeholder art until a real spritesheet is added. */
  emoji: string;
  color: number;
}

export const SYMBOLS: Record<SymbolId, SymbolDefinition> = {
  cherry: { weight: 30, payout: 5, emoji: "🍒", color: 0x7a1f2b },
  lemon: { weight: 25, payout: 8, emoji: "🍋", color: 0x7a6a1f },
  bell: { weight: 18, payout: 12, emoji: "🔔", color: 0x6b4a12 },
  star: { weight: 12, payout: 20, emoji: "⭐", color: 0x23407a },
  seven: { weight: 8, payout: 40, emoji: "7️⃣", color: 0x4a1f7a },
  diamond: { weight: 5, payout: 100, emoji: "💎", color: 0x1f6b6b },
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
