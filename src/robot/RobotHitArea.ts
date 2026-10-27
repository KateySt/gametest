import { Circle, Container } from "pixi.js";
import { type Point } from "./RobotBrain";

const DOUBLE_TAP_MS = 320;

/**
 * Invisible Pixi circle that follows the 3D robot, so clicks on the robot go
 * through Pixi's normal event system (no DOM overlay as on the website).
 */
export class RobotHitArea extends Container {
  private readonly area = new Circle(0, 0, 1);
  private lastTap = 0;

  constructor(handlers: {
    onTap: () => void;
    onDoubleTap: () => void;
    onHover: () => void;
  }) {
    super();
    this.eventMode = "static";
    this.cursor = "pointer";
    this.hitArea = this.area;
    this.on("pointerover", handlers.onHover);
    this.on("pointertap", () => {
      const now = performance.now();
      if (now - this.lastTap < DOUBLE_TAP_MS) handlers.onDoubleTap();
      else handlers.onTap();
      this.lastTap = now;
    });
  }

  follow(center: Point, radius: number): void {
    this.position.set(center.x, center.y);
    this.area.radius = radius;
  }
}
