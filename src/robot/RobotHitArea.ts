import { Circle, Container, type FederatedPointerEvent } from "pixi.js";
import { type Point } from "./RobotBrain";

const DOUBLE_TAP_MS = 320;
const LONG_PRESS_MS = 420;
const DRAG_START_PX = 8;

export interface RobotGestureHandlers {
  /** Short tap. */
  onTap(): void;
  onDoubleTap(): void;
  /** Mouse entered the robot. */
  onHover(): void;
  /** Pressed / let go (squash while held). */
  onPress(pressing: boolean): void;
  /** Held still long enough: the "hug". */
  onHug(): void;
  /** Drag offset in the parent's (design) coordinates, rubber-banded; null when it ends. */
  onDrag(offset: Point | null): void;
  /** Let go after a drag (`hop` false) or a hug (`hop` true). */
  onRelease(strength: number, hop: boolean): void;
}

/** The further you pull, the harder it resists. */
const rubberBand = (value: number) =>
  Math.sign(value) * Math.pow(Math.abs(value), 0.82);

/**
 * Invisible Pixi circle that follows the 3D robot and turns pointer input into
 * gestures (the portfolio did this with a DOM overlay; here it is plain Pixi):
 *
 *   tap → poke · double tap → jump · hover → wink
 *   long press → hug, release → hop · drag → taffy stretch, release → bounce
 */
export class RobotHitArea extends Container {
  private readonly area = new Circle(0, 0, 1);
  private lastTap = 0;
  private pointerId = -1;
  private start: Point = { x: 0, y: 0 };
  private dragging = false;
  private hugged = false;
  private longTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly handlers: RobotGestureHandlers) {
    super();
    this.eventMode = "static";
    this.cursor = "grab";
    this.hitArea = this.area;

    this.on("pointerover", (event) => {
      if (event.pointerType === "mouse") handlers.onHover();
    });
    this.on("pointerdown", this.onDown, this);
    // globalpointermove keeps reporting while the pointer leaves the circle
    this.on("globalpointermove", this.onMove, this);
    this.on("pointerup", this.onUp, this);
    this.on("pointerupoutside", this.onUp, this);
  }

  follow(center: Point, radius: number): void {
    this.position.set(center.x, center.y);
    this.area.radius = radius;
  }

  private onDown(event: FederatedPointerEvent): void {
    if (this.pointerId !== -1) return;
    this.pointerId = event.pointerId;
    this.start = event.getLocalPosition(this.parent!);
    this.dragging = false;
    this.hugged = false;
    this.cursor = "grabbing";
    this.handlers.onPress(true);
    this.longTimer = setTimeout(() => {
      if (this.dragging) return;
      this.hugged = true;
      this.handlers.onHug();
      vibrate(25);
    }, LONG_PRESS_MS);
  }

  private onMove(event: FederatedPointerEvent): void {
    if (event.pointerId !== this.pointerId) return;
    const point = event.getLocalPosition(this.parent!);
    const dx = point.x - this.start.x;
    const dy = point.y - this.start.y;
    if (!this.dragging && Math.hypot(dx, dy) > DRAG_START_PX && !this.hugged) {
      this.dragging = true;
      clearTimeout(this.longTimer);
    }
    if (this.dragging) {
      this.handlers.onDrag({ x: rubberBand(dx), y: rubberBand(dy) });
    }
  }

  private onUp(event: FederatedPointerEvent): void {
    if (event.pointerId !== this.pointerId) return;
    clearTimeout(this.longTimer);
    this.pointerId = -1;
    this.cursor = "grab";
    this.handlers.onPress(false);

    if (this.dragging) {
      const end = event.getLocalPosition(this.parent!);
      const distance = Math.hypot(end.x - this.start.x, end.y - this.start.y);
      this.handlers.onDrag(null);
      this.handlers.onRelease(Math.min(1.6, 0.6 + distance / 200), false);
      vibrate(12);
      return;
    }
    if (this.hugged) {
      this.handlers.onRelease(1, true);
      return;
    }
    const now = performance.now();
    if (now - this.lastTap < DOUBLE_TAP_MS) {
      this.handlers.onDoubleTap();
      this.lastTap = 0;
      vibrate(18);
    } else {
      this.handlers.onTap();
      this.lastTap = now;
      vibrate(10);
    }
  }
}

/** Haptics on Android; iOS Safari has no Vibration API. */
function vibrate(ms: number): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
}
