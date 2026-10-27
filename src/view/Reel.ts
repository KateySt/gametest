import gsap from "gsap";
import { BlurFilter, Container, Sprite } from "pixi.js";
import { ROW_COUNT, type SymbolId } from "../config/slotConfig";
import { CELL_SIZE } from "./layout";
import { type SymbolTextures } from "./symbolTextures";

/**
 * One vertical reel. It is a *view*: it never decides what lands, it is told.
 *
 * Symbols live on a "strip" (array of ids). Strip index k is drawn at
 * y = (k - offset) * CELL_SIZE, so tweening `offset` scrolls the reel.
 * Only ROW_COUNT + 1 sprites exist; they are re-textured as the strip
 * scrolls past instead of creating/destroying sprites (object reuse).
 */
export class Reel extends Container {
  private readonly sprites: Sprite[] = [];
  private readonly blur = new BlurFilter({ strength: 0, quality: 2 });
  private strip: SymbolId[];
  private offset = 1;
  private previousOffset = 1;
  private tween: gsap.core.Tween | null = null;

  constructor(
    private readonly textures: SymbolTextures,
    initialSymbols: SymbolId[],
  ) {
    super();
    // Index 0 and the last index are padding shown only during overshoot.
    this.strip = [initialSymbols[0], ...initialSymbols, initialSymbols[0]];

    for (let i = 0; i <= ROW_COUNT; i++) {
      const sprite = new Sprite();
      sprite.anchor.set(0.5);
      sprite.x = CELL_SIZE / 2;
      this.sprites.push(sprite);
      this.addChild(sprite);
    }
    this.render();
  }

  /** Sprite currently showing a visible row. Valid only while the reel rests. */
  spriteAt(row: number): Sprite {
    return this.sprites[row];
  }

  async spinTo(
    target: SymbolId[],
    fillerCount: number,
    nextFiller: () => SymbolId,
    duration: number,
  ): Promise<void> {
    const current = this.strip.slice(1, 1 + ROW_COUNT);
    const fillers = Array.from({ length: fillerCount }, nextFiller);
    // [pad, target..., fillers..., current..., pad] — scrolling offset from
    // the "current" window down to 1 brings the target into view.
    this.strip = [
      nextFiller(),
      ...target,
      ...fillers,
      ...current,
      nextFiller(),
    ];
    this.offset = this.previousOffset = 1 + ROW_COUNT + fillerCount;
    this.render();

    this.filters = [this.blur];
    this.tween = gsap.to(this, {
      offset: 1,
      duration,
      ease: "back.out(0.7)",
      onUpdate: () => this.render(),
    });
    await this.tween;
    this.tween = null;
    // Filters cost a render pass each; drop it when the reel is still.
    this.filters = null;
    this.blur.strengthY = 0;
  }

  /** Quick stop: jump the running tween to its end — the final symbols show at once. */
  stopNow(): void {
    this.tween?.progress(1);
  }

  private render(): void {
    const firstIndex = Math.floor(this.offset);
    this.sprites.forEach((sprite, i) => {
      const stripIndex = firstIndex + i;
      sprite.texture = this.textures[this.strip[stripIndex] ?? this.strip[0]];
      sprite.y = (stripIndex - this.offset) * CELL_SIZE + CELL_SIZE / 2;
    });

    const speed = Math.abs(this.offset - this.previousOffset);
    this.blur.strengthY = Math.min(speed * 30, 14);
    this.previousOffset = this.offset;
  }
}
