import { EventEmitter } from "pixi.js";
import { type SlotMachine, type SpinResult } from "../core/SlotMachine";
import { StateMachine } from "../core/StateMachine";
import { type Hud, type SpinButtonMode } from "../view/Hud";
import { type Lever } from "../view/Lever";
import { type ReelSet } from "../view/ReelSet";
import { type WinPresenter } from "../view/WinPresenter";

type GameState = "idle" | "spinning" | "presenting";

/** What the rest of the app may react to without the Game knowing who listens. */
export interface GameEvents {
  spinStart: [];
  /** One reel came to rest (0 = leftmost). */
  reelStopped: [index: number];
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
  private quickStopped = false;

  constructor(
    private readonly machine: SlotMachine,
    private readonly reelSet: ReelSet,
    private readonly winPresenter: WinPresenter,
    private readonly hud: Hud,
    private readonly lever: Lever,
  ) {
    hud.showBalance(machine.balance);
    this.setControls(machine.canSpin ? "spin" : "disabled");
  }

  /** SPIN button / space: starts a spin, or quick-stops the one in progress. */
  async spin(): Promise<void> {
    if (this.flow.state === "spinning") {
      this.quickStop();
      return;
    }
    if (!this.flow.canTransitionTo("spinning") || !this.machine.canSpin) return;

    // The result is final before a single pixel moves.
    const result = this.machine.spin();
    this.flow.transitionTo("spinning");
    this.quickStopped = false;
    this.setControls("stop");
    this.hud.showWin(0);
    this.hud.showBalance(result.balanceAfter - result.totalWin);
    this.events.emit("spinStart");

    // The lever moves this very frame (instant feedback); the reels start
    // when it reaches the bottom, ~0.16 s later — like a real machine.
    await this.lever.pull();
    const reels = this.reelSet.spinTo(
      result.grid,
      () => this.machine.randomSymbol(),
      (index) => this.events.emit("reelStopped", index),
    );
    // A quick stop pressed during the pull applies as soon as reels exist.
    if (this.quickStopped) this.reelSet.stopNow();
    await reels;

    this.flow.transitionTo("presenting");
    this.setControls("disabled");
    this.events.emit("reelsStopped", result);
    this.hud.showWin(result.totalWin);
    await this.winPresenter.show(result.wins);
    this.hud.showBalance(result.balanceAfter);

    this.flow.transitionTo("idle");
    this.setControls(this.machine.canSpin ? "spin" : "disabled");
    this.events.emit("spinEnd", result);
  }

  /** SPIN button and lever are two faces of the same control. */
  private setControls(mode: SpinButtonMode): void {
    this.hud.setButtonMode(mode);
    this.lever.setEnabled(mode !== "disabled");
  }

  /** Show the final grid immediately. Once per spin. */
  private quickStop(): void {
    if (this.quickStopped) return;
    this.quickStopped = true;
    this.reelSet.stopNow();
  }
}
