import { Container, Sprite, TilingSprite } from "pixi.js";
import { blobBackgroundTexture, grainTexture } from "./softTextures";

/** Full-screen page: cream + pastel blobs + paper grain. Lives in screen px, not design px. */
export class Background extends Container {
  private readonly blobs = new Sprite(blobBackgroundTexture());
  private readonly grain = new TilingSprite({ texture: grainTexture() });

  constructor() {
    super();
    this.grain.blendMode = "multiply";
    this.grain.alpha = 0.25;
    // purely decorative: skip it in hit testing
    this.eventMode = "none";
    this.addChild(this.blobs, this.grain);
  }

  resize(width: number, height: number): void {
    this.blobs.setSize(width, height);
    this.grain.setSize(width, height);
  }
}
