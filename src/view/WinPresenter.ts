import gsap from "gsap";
import { Container, Graphics, GraphicsContext } from "pixi.js";
import { theme } from "../config/theme";
import { type LineWin } from "../core/paylines";
import { type ReelSet } from "./ReelSet";

/** Four-point "✦" sparkle, the portfolio's signature glyph. One shared geometry. */
const SPARKLE = new GraphicsContext()
  .poly([0, -18, 4, -4, 18, 0, 4, 4, 0, 18, -4, 4, -18, 0, -4, -4])
  .fill(theme.surface)
  .stroke({ width: 2, color: theme.lavenderDeep });

/** Draws winning paylines over the reels, pulses the symbols, pops sparkles. */
export class WinPresenter {
  private readonly lines = new Graphics();
  private readonly sparkleLayer = new Container();
  // Reused between wins instead of created/destroyed each time.
  private readonly sparklePool: Graphics[] = [];

  constructor(private readonly reelSet: ReelSet) {
    reelSet.addChild(this.lines, this.sparkleLayer);
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
    // white halo under a pastel line reads on any symbol
    this.lines
      .stroke({
        width: 20,
        color: theme.surface,
        alpha: 0.9,
        cap: "round",
        join: "round",
      })
      .stroke({
        width: 10,
        color: theme.blushDeep,
        cap: "round",
        join: "round",
      });

    const cells = wins.flatMap((win) => win.cells);
    const sparkles = cells.map(([reel, row], index) =>
      this.popSparkle(reel, row, index * 0.06),
    );
    await gsap.to(
      cells.map(([reel, row]) => this.reelSet.symbolAt(reel, row).scale),
      {
        x: 1.12,
        y: 1.12,
        duration: 0.25,
        yoyo: true,
        repeat: 3,
        ease: "sine.inOut",
      },
    );

    this.lines.clear();
    for (const sparkle of sparkles) {
      sparkle.visible = false;
      this.sparklePool.push(sparkle);
    }
  }

  private popSparkle(reel: number, row: number, delay: number): Graphics {
    const sparkle = this.sparklePool.pop() ?? new Graphics(SPARKLE);
    if (!sparkle.parent) this.sparkleLayer.addChild(sparkle);
    const { x, y } = this.reelSet.cellCenter(reel, row);
    sparkle.position.set(x + 52, y - 52);
    sparkle.visible = true;
    sparkle.alpha = 1;
    sparkle.rotation = 0;
    sparkle.scale.set(0);
    gsap.to(sparkle.scale, {
      x: 1,
      y: 1,
      duration: 0.35,
      delay,
      ease: "back.out(3)",
    });
    gsap.to(sparkle, {
      rotation: Math.PI / 2,
      alpha: 0,
      duration: 0.8,
      delay: delay + 0.6,
    });
    return sparkle;
  }
}
