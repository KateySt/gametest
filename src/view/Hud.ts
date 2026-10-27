import gsap from "gsap";
import {
  BitmapText,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
} from "pixi.js";
import { theme } from "../config/theme";
import { softShadowTexture } from "./softTextures";

const BUTTON_WIDTH = 300;
const BUTTON_HEIGHT = 100;
const CHIP_HEIGHT = 64;
const CHIP_GAP = 16;

/** spin: ready · stop: reels moving, press to quick-stop · disabled: busy or no balance */
export type SpinButtonMode = "spin" | "stop" | "disabled";

/** A pill with a small label and a value that changes often. */
class Chip extends Container {
  // BitmapText: values change every spin; canvas Text would re-rasterize
  // and re-upload a texture on each change.
  readonly value = new BitmapText({
    text: "",
    style: {
      fontFamily: theme.fontBody,
      fontSize: 30,
      fontWeight: "600",
      fill: theme.ink,
    },
  });

  constructor(label: string, width: number, fill: number, fillAlpha: number) {
    super();
    const shadow = new Sprite(
      softShadowTexture(width, CHIP_HEIGHT, CHIP_HEIGHT / 2, 16, 6, 0.12),
    );
    shadow.position.set(-32, -32);
    const caption = new Text({
      text: label,
      style: {
        fontFamily: theme.fontBody,
        fontSize: 18,
        fontWeight: "500",
        fill: theme.inkSoft,
      },
    });
    caption.anchor.set(0, 0.5);
    caption.position.set(24, CHIP_HEIGHT / 2);
    this.value.anchor.set(1, 0.5);
    this.value.position.set(width - 24, CHIP_HEIGHT / 2);
    this.addChild(
      shadow,
      new Graphics()
        .roundRect(0, 0, width, CHIP_HEIGHT, CHIP_HEIGHT / 2)
        .fill({ color: fill, alpha: fillAlpha })
        .stroke({
          width: 2,
          color: theme.surface,
          alpha: theme.cardBorderAlpha,
        }),
      caption,
      this.value,
    );
  }
}

/** Balance / win readouts and the SPIN button. Emits intent, holds no rules. */
export class Hud extends Container {
  private readonly balanceChip: Chip;
  private readonly winChip: Chip;
  private readonly spinButton = new Container();
  private readonly spinFace = new Container();
  private readonly spinLabel: Text;
  private mode: SpinButtonMode = "spin";

  constructor(width: number, onSpin: () => void) {
    super();

    const chipWidth = (width - CHIP_GAP) / 2;
    this.balanceChip = new Chip("balance", chipWidth, theme.surface, 0.78);
    this.winChip = new Chip("win", chipWidth, theme.butter, 1);
    // pivot at the centre so the "pop" scales in place
    this.winChip.pivot.set(chipWidth / 2, CHIP_HEIGHT / 2);
    this.winChip.position.set(
      chipWidth + CHIP_GAP + chipWidth / 2,
      CHIP_HEIGHT / 2,
    );
    this.winChip.visible = false;

    // --- SPIN: lavender pill, ink label, lifted shadow ---
    const shadow = new Sprite(
      softShadowTexture(
        BUTTON_WIDTH,
        BUTTON_HEIGHT,
        BUTTON_HEIGHT / 2,
        24,
        12,
        0.24,
      ),
    );
    shadow.position.set(-48, -48);
    this.spinFace.addChild(
      new Graphics()
        .roundRect(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT, BUTTON_HEIGHT / 2)
        .fill(theme.lavender)
        .stroke({ width: 3, color: theme.surface, alpha: 0.9 }),
    );
    this.spinLabel = new Text({
      text: "SPIN",
      style: {
        fontFamily: theme.fontDisplay,
        fontSize: 46,
        fontWeight: "800",
        fill: theme.ink,
        letterSpacing: 2,
      },
    });
    this.spinLabel.anchor.set(0.5);
    this.spinLabel.position.set(BUTTON_WIDTH / 2, BUTTON_HEIGHT / 2);
    this.spinFace.addChild(this.spinLabel);
    // scale from the centre for the press squash
    this.spinFace.pivot.set(BUTTON_WIDTH / 2, BUTTON_HEIGHT / 2);
    this.spinFace.position.set(BUTTON_WIDTH / 2, BUTTON_HEIGHT / 2);
    this.spinButton.addChild(shadow, this.spinFace);
    this.spinButton.position.set((width - BUTTON_WIDTH) / 2, 96);

    // v8 events: eventMode 'static' = interactive but never moves on its own.
    this.spinButton.eventMode = "static";
    this.spinButton.cursor = "pointer";
    // A Container has no shape of its own: with interactiveChildren off it
    // is hit-testable only through an explicit hitArea (also the cheapest test).
    this.spinButton.interactiveChildren = false;
    this.spinButton.hitArea = new Rectangle(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT);
    this.spinButton.on("pointertap", onSpin);
    this.spinButton.on("pointerover", () => this.lift(true));
    this.spinButton.on("pointerout", () => this.lift(false));
    this.spinButton.on("pointerdown", () => this.squash(true));
    this.spinButton.on("pointerup", () => this.squash(false));
    this.spinButton.on("pointerupoutside", () => this.squash(false));

    this.addChild(this.balanceChip, this.winChip, this.spinButton);
  }

  showBalance(balance: number): void {
    this.balanceChip.value.text = String(balance);
  }

  showWin(amount: number): void {
    const show = amount > 0;
    this.winChip.value.text = show ? `+${amount}` : "";
    if (show && !this.winChip.visible) {
      this.winChip.visible = true;
      gsap.fromTo(
        this.winChip.scale,
        { x: 0.6, y: 0.6 },
        { x: 1, y: 1, duration: 0.5, ease: "back.out(2.5)" },
      );
    } else if (!show) {
      this.winChip.visible = false;
    }
  }

  /** SPIN button rectangle in HUD-local coordinates. */
  get spinButtonBounds(): Rectangle {
    const { x, y } = this.spinButton;
    return new Rectangle(x, y, BUTTON_WIDTH, BUTTON_HEIGHT);
  }

  setButtonMode(mode: SpinButtonMode): void {
    this.mode = mode;
    this.spinLabel.text = mode === "stop" ? "STOP" : "SPIN";
    this.spinButton.alpha = mode === "disabled" ? 0.45 : 1;
    this.spinButton.eventMode = mode === "disabled" ? "none" : "static";
    if (mode === "disabled") this.lift(false);
  }

  private lift(up: boolean): void {
    gsap.to(this.spinFace, {
      y: BUTTON_HEIGHT / 2 - (up && this.mode !== "disabled" ? 4 : 0),
      duration: 0.2,
      ease: "power2.out",
    });
  }

  /** Press: jelly squash; release: springy bounce back. */
  private squash(down: boolean): void {
    gsap.to(this.spinFace.scale, {
      x: down ? 0.95 : 1,
      y: down ? 0.9 : 1,
      duration: down ? 0.08 : 0.5,
      ease: down ? "power2.out" : "elastic.out(1.2, 0.4)",
    });
  }
}
