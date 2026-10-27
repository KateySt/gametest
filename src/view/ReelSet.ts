import { Container, Graphics, Sprite } from "pixi.js";
import { REEL_COUNT, ROW_COUNT, type SymbolId } from "../config/slotConfig";
import { theme } from "../config/theme";
import { type SymbolGrid } from "../core/paylines";
import { CELL_SIZE, REEL_GAP } from "./layout";
import { Reel } from "./Reel";
import { softShadowTexture } from "./softTextures";
import { type SymbolTextures } from "./symbolTextures";

const FRAME_PADDING = 22;
const SHADOW_BLUR = 40;

/** The reel window: frame, mask and all reels. Stops them left to right. */
export class ReelSet extends Container {
  readonly windowWidth = REEL_COUNT * CELL_SIZE + (REEL_COUNT - 1) * REEL_GAP;
  readonly windowHeight = ROW_COUNT * CELL_SIZE;
  private readonly reels: Reel[] = [];

  constructor(textures: SymbolTextures, initialGrid: SymbolGrid) {
    super();

    // Portfolio "card-soft": frosted white card, white edge, soft lifted shadow.
    const cardWidth = this.windowWidth + FRAME_PADDING * 2;
    const cardHeight = this.windowHeight + FRAME_PADDING * 2;
    const shadow = new Sprite(
      softShadowTexture(
        cardWidth,
        cardHeight,
        theme.radiusBlob,
        SHADOW_BLUR,
        18,
        0.22,
      ),
    );
    shadow.position.set(
      -FRAME_PADDING - SHADOW_BLUR * 2,
      -FRAME_PADDING - SHADOW_BLUR * 2,
    );
    this.addChild(
      shadow,
      new Graphics()
        .roundRect(
          -FRAME_PADDING,
          -FRAME_PADDING,
          cardWidth,
          cardHeight,
          theme.radiusBlob,
        )
        .fill({ color: theme.surface, alpha: theme.cardAlpha })
        .stroke({
          width: 3,
          color: theme.surface,
          alpha: theme.cardBorderAlpha,
        })
        // reel window: a cream well inside the card
        .roundRect(-6, -6, this.windowWidth + 12, this.windowHeight + 12, 22)
        .fill({ color: theme.page, alpha: 0.9 }),
    );

    const reelLayer = new Container();
    initialGrid.forEach((symbols, index) => {
      const reel = new Reel(textures, symbols);
      reel.x = index * (CELL_SIZE + REEL_GAP);
      this.reels.push(reel);
      reelLayer.addChild(reel);
    });

    // An axis-aligned rectangle mask is the cheapest kind (GPU scissor test).
    const mask = new Graphics()
      .rect(0, 0, this.windowWidth, this.windowHeight)
      .fill(0xffffff);
    reelLayer.mask = mask;
    this.addChild(reelLayer, mask);
  }

  spinTo(
    grid: SymbolGrid,
    nextFiller: () => SymbolId,
    onReelStop?: (index: number) => void,
  ): Promise<void[]> {
    return Promise.all(
      this.reels.map((reel, index) =>
        // Later reels travel further and longer, so they stop one by one.
        reel
          .spinTo(grid[index], 16 + index * 7, nextFiller, 1.1 + index * 0.4)
          .then(() => onReelStop?.(index)),
      ),
    );
  }

  stopNow(): void {
    this.reels.forEach((reel) => reel.stopNow());
  }

  symbolAt(reel: number, row: number): Sprite {
    return this.reels[reel].spriteAt(row);
  }

  /** Outer edge of the frame in the parent's coordinates. */
  get frameBounds() {
    return {
      left: this.x - FRAME_PADDING,
      top: this.y - FRAME_PADDING,
      right: this.x + this.windowWidth + FRAME_PADDING,
      bottom: this.y + this.windowHeight + FRAME_PADDING,
    };
  }

  cellCenter(reel: number, row: number): { x: number; y: number } {
    return {
      x: reel * (CELL_SIZE + REEL_GAP) + CELL_SIZE / 2,
      y: row * CELL_SIZE + CELL_SIZE / 2,
    };
  }
}
