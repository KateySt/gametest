import {
  Assets,
  Container,
  Graphics,
  Sprite,
  type Renderer,
  type Texture,
} from "pixi.js";
import { SYMBOL_IDS, type SymbolId } from "../config/slotConfig";
import { lighten, theme } from "../config/theme";
import { SYMBOL_SIZE } from "./layout";

export type SymbolTextures = Record<SymbolId, Texture>;

/** Art + pastel tile per symbol. SVGs live in public/symbols and can be edited in Figma. */
const SYMBOL_ART: Record<SymbolId, { src: string; tile: number }> = {
  heart: { src: "/symbols/heart.svg", tile: theme.blush },
  star: { src: "/symbols/star.svg", tile: theme.butter },
  macaron: { src: "/symbols/macaron.svg", tile: theme.peach },
  cloud: { src: "/symbols/cloud.svg", tile: theme.mint },
  crystal: { src: "/symbols/crystal.svg", tile: theme.sky },
  robot: { src: "/symbols/robot.svg", tile: theme.lavender },
};

const ICON_SIZE = SYMBOL_SIZE * 0.78;

/**
 * Loads the SVG icons and bakes each "pastel tile + icon" into ONE texture,
 * so the reels render plain Sprites (which batch) instead of re-composing
 * a tile and an icon every frame.
 */
export async function loadSymbolTextures(
  renderer: Renderer,
): Promise<SymbolTextures> {
  // SVGs are rasterized at load time: ask for 2× so icons stay crisp.
  const icons: Record<string, Texture> = await Assets.load(
    SYMBOL_IDS.map((id) => ({
      alias: `symbol-${id}`,
      src: SYMBOL_ART[id].src,
      data: { resolution: 2 },
    })),
  );

  const textures = {} as SymbolTextures;
  for (const id of SYMBOL_IDS) {
    const card = new Container();
    card.addChild(
      new Graphics()
        .roundRect(0, 0, SYMBOL_SIZE, SYMBOL_SIZE, 30)
        .fill(lighten(SYMBOL_ART[id].tile, 0.45))
        .stroke({ width: 3, color: theme.surface, alpha: 0.9 }),
    );
    const icon = new Sprite(icons[`symbol-${id}`]);
    icon.anchor.set(0.5);
    icon.setSize(ICON_SIZE, ICON_SIZE);
    icon.position.set(SYMBOL_SIZE / 2, SYMBOL_SIZE / 2);
    card.addChild(icon);

    textures[id] = renderer.generateTexture({
      target: card,
      resolution: renderer.resolution,
    });
    card.destroy({ children: true });
  }
  return textures;
}
