import { EventEmitter } from "pixi.js";
import { type SlotMachine, type SpinResult } from "../core/SlotMachine";
import { StateMachine } from "../core/StateMachine";
import { type Hud } from "../view/Hud";
import { type ReelSet } from "../view/ReelSet";
import { type WinPresenter } from "../view/WinPresenter";

type GameState = "idle" | "spinning" | "presenting";

/** What the rest of the app may react to without the Game knowing who listens. */
export interface GameEvents {
  spinStart: [];
  reelsStopped: [result: SpinResult];
  spinEnd: [result: SpinResult];
}

const TRANSITIONS: Record<GameState, readonly GameState[]> = {
  idle: ["spinning"],
  spinning: ["presenting"],
  presenting: ["idle"],
};

/**
 * Controller: the only place that knows both the model and the views.
 * Flow: ask the model for the outcome → animate the reels to it → present wins.
 */
export class Game {
  private readonly flow = new StateMachine<GameState>("idle", TRANSITIONS);
  readonly events = new EventEmitter<GameEvents>();

  constructor(
    private readonly machine: SlotMachine,
    private readonly reelSet: ReelSet,
    private readonly winPresenter: WinPresenter,
    private readonly hud: Hud,
  ) {
    hud.showBalance(machine.balance);
    hud.setSpinEnabled(machine.canSpin);
  }

  async spin(): Promise<void> {
    if (!this.flow.canTransitionTo("spinning") || !this.machine.canSpin) return;

    // The result is final before a single pixel moves.
    const result = this.machine.spin();
    this.flow.transitionTo("spinning");
    this.hud.setSpinEnabled(false);
    this.hud.showWin(0);
    this.hud.showBalance(result.balanceAfter - result.totalWin);
    this.events.emit("spinStart");

    await this.reelSet.spinTo(result.grid, () => this.machine.randomSymbol());

    this.flow.transitionTo("presenting");
    this.events.emit("reelsStopped", result);
    this.hud.showWin(result.totalWin);
    await this.winPresenter.show(result.wins);
    this.hud.showBalance(result.balanceAfter);

    this.flow.transitionTo("idle");
    this.hud.setSpinEnabled(this.machine.canSpin);
    this.events.emit("spinEnd", result);
  }
}
