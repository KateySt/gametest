import gsap from "gsap";
import { Application, Container } from "pixi.js";
import {
  BET,
  REEL_COUNT,
  ROW_COUNT,
  STARTING_BALANCE,
} from "./config/slotConfig";
import { SlotMachine } from "./core/SlotMachine";
import { Game } from "./game/Game";
import { attachRobot } from "./robot/Robot";
import { RobotLayer } from "./robot/RobotLayer";
import { Hud } from "./view/Hud";
import { DESIGN_HEIGHT, DESIGN_WIDTH } from "./view/layout";
import { ReelSet } from "./view/ReelSet";
import { createSymbolTextures } from "./view/symbolTextures";
import { WinPresenter } from "./view/WinPresenter";

// three.js owns the canvas and WebGL context; Pixi renders into the same
// context (WebGL only — WebGPU cannot share it). See robot/RobotLayer.ts.
const robotLayer = new RobotLayer();

// v8: the constructor takes no options; everything goes to async init().
const app = new Application();
await app.init({
  preference: "webgl",
  canvas: robotLayer.canvas,
  context: robotLayer.context,
  background: "#1b1430",
  resizeTo: window,
  resolution: Math.min(window.devicePixelRatio, 2),
  autoDensity: true,
});
document.getElementById("pixi-container")!.appendChild(app.canvas);

// Lets the PixiJS DevTools browser extension inspect the scene (dev builds only).
if (import.meta.env.DEV) {
  (globalThis as { __PIXI_APP__?: Application }).__PIXI_APP__ = app;
}

// One clock for the whole game: GSAP tweens advance on Pixi's ticker, so
// pausing app.ticker pauses animations too, and tweens and rendering
// never drift by a frame.
gsap.ticker.remove(gsap.updateRoot);
app.ticker.add((ticker) => gsap.updateRoot(ticker.lastTime / 1000));

const machine = new SlotMachine(STARTING_BALANCE, BET);
const textures = createSymbolTextures(app.renderer);
const initialGrid = Array.from({ length: REEL_COUNT }, () =>
  Array.from({ length: ROW_COUNT }, () => machine.randomSymbol()),
);

const root = new Container();
app.stage.addChild(root);

const reelSet = new ReelSet(textures, initialGrid);
reelSet.position.set((DESIGN_WIDTH - reelSet.windowWidth) / 2, 160);
const winPresenter = new WinPresenter(reelSet);

// The callback runs only on click, after `game` below is initialized.
const hud = new Hud(reelSet.windowWidth, () => void game.spin());
hud.position.set(reelSet.x, reelSet.y + reelSet.windowHeight + 50);

root.addChild(reelSet, hud);
const game = new Game(machine, reelSet, winPresenter, hud);

window.addEventListener("keydown", (event) => {
  if (event.code === "Space") void game.spin();
});

// Letterbox: scale the fixed design resolution to fit any window.
function fitToScreen(): void {
  const { width, height } = app.screen;
  const scale = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
  root.scale.set(scale);
  root.position.set(
    (width - DESIGN_WIDTH * scale) / 2,
    (height - DESIGN_HEIGHT * scale) / 2,
  );
}
app.renderer.on("resize", fitToScreen);
fitToScreen();

// The SPIN button in design coordinates, for the robot's "press me" spot.
const spinButton = hud.spinButtonBounds;
await attachRobot({
  app,
  root,
  layer: robotLayer,
  game,
  layout: {
    frame: reelSet.frameBounds,
    button: {
      left: hud.x + spinButton.x,
      top: hud.y + spinButton.y,
      right: hud.x + spinButton.x + spinButton.width,
      bottom: hud.y + spinButton.y + spinButton.height,
    },
  },
});
