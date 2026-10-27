import gsap from "gsap";
import {
  Circle,
  Container,
  Graphics,
  type FederatedPointerEvent,
} from "pixi.js";
import { theme } from "../config/theme";

export const LEVER_LENGTH = 150;
const KNOB_RADIUS = 26;
/** Fully pulled: past horizontal, towards the player. */
const PULLED = 2.6;
/** Releasing a drag below this angle counts as a pull. */
const PULL_THRESHOLD = 1.6;

/**
 * The one-armed-bandit lever on the machine's side. Pseudo-3D in pure 2D:
 * the lever swings towards the viewer around a horizontal axis, so the stick
 * is foreshortened (scaleY = cos θ, flipping below the pivot) and the knob
 * grows as it comes closer. Three Graphics, transforms only — no filters.
 *
 * Origin = pivot. It only reports "I was pulled"; the Game decides what happens.
 */
export class Lever extends Container {
  private readonly stick = new Graphics()
    .roundRect(-9, -LEVER_LENGTH, 18, LEVER_LENGTH, 9)
    .fill(theme.page)
    .stroke({ width: 5, color: theme.ink });
  private readonly knob = new Graphics()
    .circle(0, 0, KNOB_RADIUS)
    .fill(theme.blush)
    .stroke({ width: 5, color: theme.ink })
    .ellipse(-9, -10, 9, 5)
    .fill({ color: theme.surface, alpha: 0.9 });
  private readonly grabArea = new Circle(0, 0, KNOB_RADIUS + 14);
  /** 0 = up, PULLED = down. */
  private swing = 0;
  private enabled = true;
  private dragging = false;
  private dragMoved = false;

  constructor(private readonly onPull: () => void) {
    super();
    const mount = new Graphics()
      .roundRect(-22, -34, 34, 68, 14)
      .fill(theme.peach)
      .stroke({ width: 5, color: theme.ink })
      .circle(0, 0, 12)
      .fill(theme.peachDeep)
      .stroke({ width: 4, color: theme.ink });
    this.addChild(this.stick, mount, this.knob);

    // Only the knob is grabbable: pointer handlers live on it.
    this.knob.eventMode = "static";
    this.knob.cursor = "grab";
    this.knob.hitArea = this.grabArea;
    this.knob.on("pointerdown", this.onDown, this);
    this.knob.on("globalpointermove", this.onMove, this);
    this.knob.on("pointerup", this.onUp, this);
    this.knob.on("pointerupoutside", this.onUp, this);
    this.render();
  }

  /** Knob position (parent coordinates) when the lever is up — for the robot. */
  get knobRestPosition(): { x: number; y: number } {
    return { x: this.x, y: this.y - LEVER_LENGTH };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.knob.cursor = enabled ? "grab" : "default";
  }

  /**
   * Pull down fast (the spin starts when this resolves), then spring back
   * on its own. Instant visual feedback: it moves in the same frame.
   */
  async pull(): Promise<void> {
    gsap.killTweensOf(this);
    await gsap.to(this, {
      swing: PULLED,
      duration: 0.16 * (1 - this.swing / PULLED) + 0.02,
      ease: "power2.in",
      onUpdate: () => this.render(),
    });
    this.springBack();
  }

  /** Idle "come on, pull me" wiggle while the robot holds the knob. */
  tease(): void {
    if (this.dragging) return;
    gsap.killTweensOf(this);
    gsap.to(this, {
      swing: 0.35,
      duration: 0.22,
      yoyo: true,
      repeat: 5,
      ease: "sine.inOut",
      onUpdate: () => this.render(),
      onComplete: () => this.springBack(),
    });
  }

  private springBack(): void {
    gsap.to(this, {
      swing: 0,
      duration: 0.9,
      ease: "elastic.out(1.1, 0.35)",
      onUpdate: () => this.render(),
    });
  }

  private render(): void {
    const cos = Math.cos(this.swing);
    const sin = Math.sin(this.swing);
    this.stick.scale.y = cos; // negative: the stick points down past the pivot
    this.knob.y = -LEVER_LENGTH * cos;
    this.knob.scale.set(1 + 0.25 * sin);
  }

  // --- drag the knob down like a real lever ---

  private onDown(event: FederatedPointerEvent): void {
    if (!this.enabled) return;
    event.stopPropagation();
    gsap.killTweensOf(this);
    this.dragging = true;
    this.dragMoved = false;
    this.knob.cursor = "grabbing";
  }

  private onMove(event: FederatedPointerEvent): void {
    if (!this.dragging) return;
    const local = event.getLocalPosition(this);
    // Knob height above the pivot → swing angle.
    const height = Math.max(-1, Math.min(1, -local.y / LEVER_LENGTH));
    const angle = Math.min(Math.acos(height), PULLED);
    if (Math.abs(angle - this.swing) > 0.05) this.dragMoved = true;
    this.swing = angle;
    this.render();
  }

  private onUp(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.knob.cursor = "grab";
    // A click (no drag) or a drag released low enough = a pull.
    if (!this.dragMoved || this.swing >= PULL_THRESHOLD) this.onPull();
    // onPull runs Game.spin() synchronously up to lever.pull(): if no pull
    // tween started (no balance, quick stop…), the lever returns on its own.
    if (!gsap.isTweening(this)) this.springBack();
  }
}
