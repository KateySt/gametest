import { Texture } from "pixi.js";
import { theme } from "../config/theme";

// Soft, blurry things are drawn ONCE with Canvas 2D (which blurs for free)
// and uploaded as textures. Doing the same with Pixi filters would cost a
// render pass every frame.

const css = (color: number, alpha = 1) =>
  `rgba(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255}, ${alpha})`;

function canvas(width: number, height: number) {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  return { element, context: element.getContext("2d")! };
}

/**
 * Portfolio "shadow-soft/lift": a blurred ink-tinted rounded rect.
 * The texture is larger than the box by `blur` on each side; place it at -blur.
 */
export function softShadowTexture(
  width: number,
  height: number,
  radius: number,
  blur: number,
  offsetY: number,
  alpha: number,
): Texture {
  const pad = blur * 2;
  const { element, context } = canvas(width + pad * 2, height + pad * 2);
  context.shadowColor = `rgba(${theme.shadow}, ${alpha})`;
  context.shadowBlur = blur;
  context.shadowOffsetY = offsetY;
  // Draw the box far outside the canvas and keep only its shadow.
  const shift = element.width * 2;
  context.shadowOffsetX = shift;
  context.beginPath();
  context.roundRect(pad - shift, pad, width, height, radius);
  context.fill();
  return Texture.from(element);
}

/** Cream page with large, very soft pastel blobs (stretched to the screen). */
export function blobBackgroundTexture(): Texture {
  const size = 512;
  const { element, context } = canvas(size, size);
  context.fillStyle = css(theme.page);
  context.fillRect(0, 0, size, size);
  const blob = (
    x: number,
    y: number,
    r: number,
    color: number,
    alpha: number,
  ) => {
    const gradient = context.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, css(color, alpha));
    gradient.addColorStop(1, css(color, 0));
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  };
  blob(90, 80, 300, theme.lavender, 0.55);
  blob(450, 430, 320, theme.peach, 0.5);
  blob(70, 470, 240, theme.mint, 0.45);
  blob(460, 90, 200, theme.blush, 0.35);
  return Texture.from(element);
}

/** Tileable paper grain (multiplied over the page like the portfolio's). */
export function grainTexture(): Texture {
  const size = 128;
  const { element, context } = canvas(size, size);
  const image = context.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = 200 + Math.random() * 55;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return Texture.from(element);
}
