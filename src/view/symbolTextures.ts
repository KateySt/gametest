import {
  Container,
  Graphics,
  Text,
  type Renderer,
  type Texture,
} from "pixi.js";
import { SYMBOL_IDS, SYMBOLS, type SymbolId } from "../config/slotConfig";
import { SYMBOL_SIZE } from "./layout";

export type SymbolTextures = Record<SymbolId, Texture>;

/**
 * Placeholder art: each symbol is drawn once with Graphics + Text and baked
 * into a Texture, so the reels render plain Sprites (which batch) instead of
 * re-drawing vector shapes and canvas text every frame.
 * Swap this for a spritesheet loaded via Assets when real art exists.
 */
export function createSymbolTextures(renderer: Renderer): SymbolTextures {
  const textures = {} as SymbolTextures;

  for (const id of SYMBOL_IDS) {
    const card = new Container();
    card.addChild(
      new Graphics()
        .roundRect(0, 0, SYMBOL_SIZE, SYMBOL_SIZE, 26)
        .fill(SYMBOLS[id].color)
        .stroke({ width: 4, color: 0xffffff, alpha: 0.18 }),
    );

    const label = new Text({
      text: SYMBOLS[id].emoji,
      style: { fontSize: SYMBOL_SIZE * 0.58 },
    });
    label.anchor.set(0.5);
    label.position.set(SYMBOL_SIZE / 2, SYMBOL_SIZE / 2);
    card.addChild(label);

    textures[id] = renderer.generateTexture({
      target: card,
      resolution: renderer.resolution,
    });
    card.destroy({ children: true });
  }

  return textures;
}
