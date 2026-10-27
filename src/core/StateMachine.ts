/**
 * Minimal finite state machine. One current state instead of a pile of
 * booleans (isSpinning, isShowingWin, ...) makes illegal combinations
 * impossible: you cannot press SPIN while the reels are still moving.
 */
export class StateMachine<State extends string> {
  private current: State;

  constructor(
    initial: State,
    private readonly transitions: Record<State, readonly State[]>,
    private readonly onChange?: (from: State, to: State) => void,
  ) {
    this.current = initial;
  }

  get state(): State {
    return this.current;
  }

  canTransitionTo(next: State): boolean {
    return this.transitions[this.current].includes(next);
  }

  transitionTo(next: State): void {
    if (!this.canTransitionTo(next)) {
      throw new Error(`Illegal transition ${this.current} -> ${next}`);
    }
    const previous = this.current;
    this.current = next;
    this.onChange?.(previous, next);
  }
}
