import { BitmapText, Container, Graphics, Rectangle, Text } from "pixi.js";

const BUTTON_WIDTH = 300;
const BUTTON_HEIGHT = 100;

/** Balance / win readouts and the SPIN button. Emits intent, holds no rules. */
export class Hud extends Container {
  // BitmapText: these change every spin; canvas Text would re-rasterize
  // and re-upload a texture on each change.
  private readonly balanceText = new BitmapText({
    text: "",
    style: { fontFamily: "Arial", fontSize: 40, fill: 0xffffff },
  });
  private readonly winText = new BitmapText({
    text: "",
    style: { fontFamily: "Arial", fontSize: 40, fill: 0xffe066 },
  });
  private readonly spinButton = new Container();

  constructor(width: number, onSpin: () => void) {
    super();

    this.balanceText.position.set(0, 0);
    this.winText.anchor.set(1, 0);
    this.winText.position.set(width, 0);

    this.spinButton.addChild(
      new Graphics()
        .roundRect(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT, BUTTON_HEIGHT / 2)
        .fill(0xe23d4b)
        .stroke({ width: 6, color: 0xffffff, alpha: 0.6 }),
    );
    const label = new Text({
      text: "SPIN",
      style: {
        fontFamily: "Arial",
        fontSize: 46,
        fontWeight: "bold",
        fill: 0xffffff,
      },
    });
    label.anchor.set(0.5);
    label.position.set(BUTTON_WIDTH / 2, BUTTON_HEIGHT / 2);
    this.spinButton.addChild(label);
    this.spinButton.position.set((width - BUTTON_WIDTH) / 2, 90);

    // v8 events: eventMode 'static' = interactive but never moves on its own.
    this.spinButton.eventMode = "static";
    this.spinButton.cursor = "pointer";
    // A Container has no shape of its own: with interactiveChildren off it
    // is hit-testable only through an explicit hitArea (also the cheapest test).
    this.spinButton.interactiveChildren = false;
    this.spinButton.hitArea = new Rectangle(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT);
    this.spinButton.on("pointertap", onSpin);

    this.addChild(this.balanceText, this.winText, this.spinButton);
  }

  showBalance(balance: number): void {
    this.balanceText.text = `BALANCE ${balance}`;
  }

  showWin(amount: number): void {
    this.winText.text = amount > 0 ? `WIN ${amount}` : "";
  }

  /** SPIN button rectangle in HUD-local coordinates. */
  get spinButtonBounds(): Rectangle {
    const { x, y } = this.spinButton;
    return new Rectangle(x, y, BUTTON_WIDTH, BUTTON_HEIGHT);
  }

  setSpinEnabled(enabled: boolean): void {
    this.spinButton.alpha = enabled ? 1 : 0.4;
    this.spinButton.eventMode = enabled ? "static" : "none";
  }
}
