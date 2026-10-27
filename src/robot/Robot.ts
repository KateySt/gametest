import {
  UPDATE_PRIORITY,
  type Application,
  type Container,
  type Texture,
} from "pixi.js";
import { BET, type SymbolId } from "../config/slotConfig";
import { type Game } from "../game/Game";
import { RobotBrain, type RobotLayout } from "./RobotBrain";
import { RobotHitArea } from "./RobotHitArea";
import { type RobotLayer } from "./RobotLayer";
import { RobotRig } from "./RobotRig";
import { ThoughtBubble } from "./ThoughtBubble";

/**
 * Wires the robot into the game: brain (behaviour) → rig (3D body) → layer
 * (shared-context rendering), plus input and game events. The Game itself
 * never knows the robot exists; it only emits events.
 */
export async function attachRobot(options: {
  app: Application;
  root: Container;
  layer: RobotLayer;
  layout: RobotLayout;
  game: Game;
  symbolTextures: Record<SymbolId, Texture>;
}): Promise<void> {
  const { app, root, layer, layout, game, symbolTextures } = options;
  const rig = await RobotRig.load("/robot.glb");
  layer.scene.add(rig.object);

  const brain = new RobotBrain(layout);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Gestures are physical reactions layered on top of any clip: they move the
  // body (rig) and only tell the brain "the user is here" / "hold still".
  const now = () => performance.now();
  const hitArea = new RobotHitArea({
    onTap: () => {
      brain.onUserActivity(now());
      rig.poke(now());
    },
    onDoubleTap: () => {
      brain.onUserActivity(now());
      rig.doublePoke(now());
    },
    onHover: () => rig.hover(now()),
    onPress: (pressing) => {
      brain.setHeld(pressing, now());
      rig.setPressing(pressing);
    },
    onHug: () => rig.hug(),
    onDrag: (offset) => rig.setDrag(offset),
    onRelease: (strength, hop) => rig.release(now(), strength, hop),
  });
  const bubble = new ThoughtBubble(symbolTextures);
  root.addChild(hitArea, bubble);

  // Input: any pointer activity anywhere counts as "the user is here".
  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;
  app.stage.on("globalpointermove", (event) =>
    brain.onUserActivity(performance.now(), root.toLocal(event.global)),
  );
  app.stage.on("pointerdown", () => brain.onUserActivity(performance.now()));
  window.addEventListener("keydown", () =>
    brain.onUserActivity(performance.now()),
  );

  game.events.on("spinStart", () => brain.onSpinStart(performance.now()));
  game.events.on("reelStopped", () => brain.onReelStopped());
  game.events.on("reelsStopped", (result) =>
    brain.onReelsStopped(performance.now(), result.totalWin, BET),
  );

  const syncSize = () =>
    layer.resize(app.screen.width, app.screen.height, app.renderer.resolution);
  app.renderer.on("resize", syncSize);
  syncSize();

  // Before Pixi renders (its render runs at LOW priority): think, move, and
  // hand the GL state back to Pixi after three used it last frame.
  app.ticker.add(
    (ticker) => {
      const now = ticker.lastTime;
      const motion = !reducedMotion.matches;
      const topLeft = root.toLocal({ x: 0, y: 0 });
      const bottomRight = root.toLocal({
        x: app.screen.width,
        y: app.screen.height,
      });
      const visible = {
        left: topLeft.x,
        top: topLeft.y,
        right: bottomRight.x,
        bottom: bottomRight.y,
      };
      const intent = brain.update(now, visible, rig.position, motion);

      if (intent.dream) {
        const head = rig.position;
        bubble.show(intent.dream.symbol, intent.dream.bubble, {
          x: head.x,
          y: head.y - rig.radius,
        });
      } else {
        bubble.hide();
      }
      rig.update(intent, now, ticker.deltaMS / 1000, motion, {
        toScreen: (point) => root.toGlobal(point),
        scale: root.scale.x,
        width: app.screen.width,
        height: app.screen.height,
      });
      hitArea.follow(rig.position, rig.radius);
      app.renderer.resetState();
    },
    undefined,
    UPDATE_PRIORITY.NORMAL,
  );

  // After Pixi has drawn the game: draw the robot on top.
  app.ticker.add(() => layer.render(), undefined, UPDATE_PRIORITY.UTILITY);
}
