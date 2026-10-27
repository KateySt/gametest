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
import { Hud } from "./view/Hud";
import { DESIGN_HEIGHT, DESIGN_WIDTH } from "./view/layout";
import { ReelSet } from "./view/ReelSet";
import { createSymbolTextures } from "./view/symbolTextures";
import { WinPresenter } from "./view/WinPresenter";

// v8: the constructor takes no options; everything goes to async init().
const app = new Application();
await app.init({
  background: "#1b1430",
  resizeTo: window,
  antialias: true,
  resolution: Math.min(window.devicePixelRatio, 2),
  autoDensity: true,
});
document.getElementById("pixi-container")!.appendChild(app.canvas);

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
