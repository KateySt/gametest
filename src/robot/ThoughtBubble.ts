import gsap from "gsap";
import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { type SymbolId } from "../config/slotConfig";
import { theme } from "../config/theme";
import { type Point } from "./RobotBrain";

const ICON = 58;
const GAP = 8;
const WIDTH = ICON * 3 + GAP * 2 + 48;
const HEIGHT = ICON + 40;

/**
 * Comic "thought" cloud (with a trail of little circles, not a speech tail):
 * the robot daydreams of three symbols in a row. It reuses the reels' baked
 * symbol textures — no new assets, batched with the reels — and is invisible
 * (free) the rest of the time.
 */
export class ThoughtBubble extends Container {
  private readonly cloud = new Container();
  private readonly icons: Sprite[] = [];
  private readonly sparkle = new Graphics()
    .poly([0, -16, 4, -4, 16, 0, 4, 4, 0, 16, -4, 4, -16, 0, -4, -4])
    .fill(theme.butter)
    .stroke({ width: 2, color: theme.ink });
  private showing = false;

  private readonly trail = new Graphics();

  constructor(private readonly textures: Record<SymbolId, Texture>) {
    super();
    this.eventMode = "none";
    this.visible = false;

    // puffy cloud: overlapping circles, outline drawn first so it reads as one shape
    const puffs: [number, number, number][] = [
      [-WIDTH / 2 + 30, 6, 30],
      [-WIDTH / 4, -HEIGHT / 2 + 14, 32],
      [WIDTH / 8, -HEIGHT / 2 + 10, 34],
      [WIDTH / 2 - 32, -4, 30],
      [WIDTH / 4, HEIGHT / 2 - 14, 28],
      [-WIDTH / 6, HEIGHT / 2 - 12, 28],
    ];
    const shape = new Graphics();
    for (const [x, y, r] of puffs) shape.circle(x, y, r + 3).fill(theme.ink);
    shape
      .roundRect(-WIDTH / 2 - 3, -HEIGHT / 2 - 3, WIDTH + 6, HEIGHT + 6, 40)
      .fill(theme.ink);
    for (const [x, y, r] of puffs) shape.circle(x, y, r).fill(theme.surface);
    shape
      .roundRect(-WIDTH / 2, -HEIGHT / 2, WIDTH, HEIGHT, 38)
      .fill(theme.surface);
    this.cloud.addChild(shape);

    for (let i = 0; i < 3; i++) {
      const icon = new Sprite();
      icon.anchor.set(0.5);
      icon.x = (i - 1) * (ICON + GAP);
      this.icons.push(icon);
      this.cloud.addChild(icon);
    }
    this.sparkle.position.set(WIDTH / 2 - 14, -HEIGHT / 2 + 4);
    this.cloud.addChild(this.sparkle);
    this.addChild(this.trail, this.cloud);
  }

  /** `center` = bubble centre, `towards` = the robot's head (end of the trail). */
  show(symbol: SymbolId, center: Point, towards: Point): void {
    if (this.showing) return;
    this.showing = true;
    this.position.set(center.x, center.y);
    // trail of shrinking circles from the bubble to the robot's head
    this.trail.clear();
    for (const [k, r] of [
      [0.5, 11],
      [0.7, 8],
      [0.86, 5],
    ] as const) {
      this.trail
        .circle((towards.x - center.x) * k, (towards.y - center.y) * k, r)
        .fill(theme.surface)
        .stroke({ width: 3, color: theme.ink });
    }
    gsap.killTweensOf([
      this,
      this.scale,
      this.sparkle.scale,
      ...this.icons.map((i) => i.scale),
    ]);
    this.visible = true;
    this.alpha = 1;
    gsap.fromTo(
      this.scale,
      { x: 0.2, y: 0.2 },
      { x: 1, y: 1, duration: 0.45, ease: "back.out(2)" },
    );

    // the three symbols "land" one by one, like reels stopping
    this.icons.forEach((icon, index) => {
      icon.texture = this.textures[symbol];
      icon.setSize(ICON, ICON);
      const target = icon.scale.x;
      icon.scale.set(0);
      gsap.to(icon.scale, {
        x: target,
        y: target,
        duration: 0.35,
        delay: 0.35 + index * 0.28,
        ease: "back.out(3)",
      });
    });
    this.sparkle.scale.set(0);
    gsap.to(this.sparkle.scale, {
      x: symbol === "robot" ? 1.6 : 1,
      y: symbol === "robot" ? 1.6 : 1,
      duration: 0.3,
      delay: 1.3,
      ease: "back.out(3)",
    });
  }

  /** "Poof": a quick swell and fade. */
  hide(): void {
    if (!this.showing) return;
    this.showing = false;
    gsap.killTweensOf(this.scale);
    gsap.to(this.scale, {
      x: 1.15,
      y: 1.15,
      duration: 0.2,
      ease: "power1.out",
    });
    gsap.to(this, {
      alpha: 0,
      duration: 0.2,
      onComplete: () => {
        this.visible = false;
      },
    });
  }
}
