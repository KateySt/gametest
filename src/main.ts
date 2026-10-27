import "@fontsource/bricolage-grotesque/800.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import gsap from "gsap";
import { Application, Container } from "pixi.js";
import {
  BET,
  REEL_COUNT,
  ROW_COUNT,
  STARTING_BALANCE,
} from "./config/slotConfig";
import { theme } from "./config/theme";
import { SlotMachine } from "./core/SlotMachine";
import { Game } from "./game/Game";
import { attachRobot } from "./robot/Robot";
import { RobotLayer } from "./robot/RobotLayer";
import { Background } from "./view/Background";
import { Hud } from "./view/Hud";
import { Lever } from "./view/Lever";
import {
  CELL_SIZE,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  REEL_GAP,
} from "./view/layout";
import { ReelSet } from "./view/ReelSet";
import { loadSymbolTextures } from "./view/symbolTextures";
import { WinPresenter } from "./view/WinPresenter";

// Canvas text is rasterized with whatever font is ready at that moment, so
// the web fonts must finish loading before any Text/BitmapText is created.
await Promise.all([
  document.fonts.load(`800 46px "${theme.fontDisplay}"`),
  document.fonts.load(`500 18px "${theme.fontBody}"`),
  document.fonts.load(`600 30px "${theme.fontBody}"`),
]);

// three.js owns the canvas and WebGL context; Pixi renders into the same
// context (WebGL only — WebGPU cannot share it). See robot/RobotLayer.ts.
const robotLayer = new RobotLayer();

// v8: the constructor takes no options; everything goes to async init().
const app = new Application();
await app.init({
  preference: "webgl",
  canvas: robotLayer.canvas,
  context: robotLayer.context,
  background: theme.page,
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
const textures = await loadSymbolTextures(app.renderer);
const initialGrid = Array.from({ length: REEL_COUNT }, () =>
  Array.from({ length: ROW_COUNT }, () => machine.randomSymbol()),
);

const background = new Background();
const root = new Container();
app.stage.addChild(background, root);

const reelSet = new ReelSet(textures, initialGrid);
// Machine on the left, lever on its right side, robot's home beside the lever.
reelSet.position.set(52, 160);
const winPresenter = new WinPresenter(reelSet);

// The callback runs only on click, after `game` below is initialized.
const hud = new Hud(reelSet.windowWidth, () => void game.spin());
hud.position.set(reelSet.x, reelSet.y + reelSet.windowHeight + 50);

const lever = new Lever(() => void game.spin());
lever.position.set(
  reelSet.frameBounds.right + 28,
  reelSet.y + reelSet.windowHeight / 2,
);

root.addChild(lever, reelSet, hud);
const game = new Game(machine, reelSet, winPresenter, hud, lever);

window.addEventListener("keydown", (event) => {
  if (event.code === "Space") void game.spin();
});

// Letterbox: scale the fixed design resolution to fit any window.
function fitToScreen(): void {
  const { width, height } = app.screen;
  background.resize(width, height);
  const scale = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
  root.scale.set(scale);
  root.position.set(
    (width - DESIGN_WIDTH * scale) / 2,
    (height - DESIGN_HEIGHT * scale) / 2,
  );
}
app.renderer.on("resize", fitToScreen);
fitToScreen();

// Everything the robot needs to know about the scene, in design coordinates.
const knob = lever.knobRestPosition;
await attachRobot({
  app,
  root,
  layer: robotLayer,
  game,
  lever,
  symbolTextures: textures,
  layout: {
    home: { x: knob.x + 95, y: knob.y + 40 },
    size: 150,
    reelCenters: [0, 1, 2].map((index) => ({
      x: reelSet.x + index * (CELL_SIZE + REEL_GAP) + CELL_SIZE / 2,
      y: reelSet.y + reelSet.windowHeight / 2,
    })),
    bubble: { x: knob.x - 60, y: 78 },
  },
});
