import gsap from "gsap";
import { Graphics } from "pixi.js";
import { type LineWin } from "../core/paylines";
import { type ReelSet } from "./ReelSet";

/** Draws winning paylines over the reels and pulses the winning symbols. */
export class WinPresenter {
  private readonly lines = new Graphics();

  constructor(private readonly reelSet: ReelSet) {
    reelSet.addChild(this.lines);
  }

  async show(wins: LineWin[]): Promise<void> {
    if (wins.length === 0) return;

    for (const win of wins) {
      win.cells.forEach(([reel, row], index) => {
        const { x, y } = this.reelSet.cellCenter(reel, row);
        if (index === 0) this.lines.moveTo(x, y);
        else this.lines.lineTo(x, y);
      });
    }
    this.lines.stroke({ width: 10, color: 0xffe066, cap: "round" });

    const sprites = wins.flatMap((win) =>
      win.cells.map(([reel, row]) => this.reelSet.symbolAt(reel, row)),
    );
    await gsap.to(
      sprites.map((sprite) => sprite.scale),
      { x: 1.15, y: 1.15, duration: 0.25, yoyo: true, repeat: 3 },
    );

    this.lines.clear();
  }
}
