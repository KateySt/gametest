import { type SymbolId } from "../config/slotConfig";

/** grid[reel][row] — the same orientation the reels are drawn in. */
export type SymbolGrid = SymbolId[][];

export interface LineWin {
  lineIndex: number;
  symbol: SymbolId;
  /** [reel, row] of each winning cell, for the win presentation. */
  cells: [number, number][];
  amount: number;
}

export function evaluatePaylines(
  grid: SymbolGrid,
  paylines: readonly (readonly number[])[],
  payoutOf: (symbol: SymbolId) => number,
  bet: number,
): LineWin[] {
  const wins: LineWin[] = [];
  paylines.forEach((rows, lineIndex) => {
    const symbols = rows.map((row, reel) => grid[reel][row]);
    const first = symbols[0];
    if (symbols.every((symbol) => symbol === first)) {
      wins.push({
        lineIndex,
        symbol: first,
        cells: rows.map((row, reel) => [reel, row]),
        amount: payoutOf(first) * bet,
      });
    }
  });
  return wins;
}
