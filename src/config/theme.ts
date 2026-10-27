// Design tokens, taken from the portfolio (app/globals.css, light theme).
// Every colour in the game comes from here — a dark theme later is one more object.

export const theme = {
  page: 0xfff8f1, // cream
  ink: 0x2b2440,
  inkSoft: 0x5a5170,
  surface: 0xffffff,

  lavender: 0xc9b8f5,
  peach: 0xffc8b0,
  mint: 0xb8e6d2,
  sky: 0xbfddf7,
  butter: 0xfff1a8,
  blush: 0xffc6d9,

  lavenderDeep: 0xa48ae8,
  peachDeep: 0xf5a283,
  mintDeep: 0x7fcfae,
  skyDeep: 0x8cc0ee,
  butterDeep: 0xf2d860,
  blushDeep: 0xf59bbb,

  /** rgb of shadows: soft ink, never black. */
  shadow: "43, 36, 64",
  cardAlpha: 0.62,
  cardBorderAlpha: 0.8,
  radiusBlob: 32,

  fontDisplay: "Bricolage Grotesque",
  fontBody: "Inter",
} as const;

/** Mix a colour towards white: 0 = colour, 1 = white. */
export function lighten(color: number, amount: number): number {
  const channel = (shift: number) => {
    const value = (color >> shift) & 0xff;
    return Math.round(value + (255 - value) * amount) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}
