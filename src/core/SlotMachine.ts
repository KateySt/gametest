import {
  PAYLINES,
  REEL_COUNT,
  ROW_COUNT,
  SYMBOL_IDS,
  SYMBOLS,
} from "../config/slotConfig";
import { evaluatePaylines, type LineWin, type SymbolGrid } from "./paylines";
import { pickWeighted, type Random } from "./rng";

export interface SpinResult {
  grid: SymbolGrid;
  wins: LineWin[];
  totalWin: number;
  balanceAfter: number;
}

/**
 * The game model. Pure TypeScript: it knows nothing about rendering or time.
 * The outcome of a spin is decided here, instantly; the reels only *show* it.
 */
export class SlotMachine {
  private currentBalance: number;

  constructor(
    startingBalance: number,
    readonly bet: number,
    private readonly random: Random = Math.random,
  ) {
    this.currentBalance = startingBalance;
  }

  get balance(): number {
    return this.currentBalance;
  }

  get canSpin(): boolean {
    return this.currentBalance >= this.bet;
  }

  spin(): SpinResult {
    if (!this.canSpin) throw new Error("Not enough balance to spin");

    this.currentBalance -= this.bet;
    const grid = this.rollGrid();
    const wins = evaluatePaylines(
      grid,
      PAYLINES,
      (symbol) => SYMBOLS[symbol].payout,
      this.bet,
    );
    const totalWin = wins.reduce((sum, win) => sum + win.amount, 0);
    this.currentBalance += totalWin;

    return { grid, wins, totalWin, balanceAfter: this.currentBalance };
  }

  /** A random symbol, used by the view for blurred filler while spinning. */
  randomSymbol() {
    return pickWeighted(SYMBOL_IDS, (id) => SYMBOLS[id].weight, this.random);
  }

  private rollGrid(): SymbolGrid {
    return Array.from({ length: REEL_COUNT }, () =>
      Array.from({ length: ROW_COUNT }, () => this.randomSymbol()),
    );
  }
}
