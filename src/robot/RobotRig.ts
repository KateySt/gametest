import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { type Point, type RobotIntent } from "./RobotBrain";
import { CLIPS, type ClipEvent, type PoseFrame } from "./clips";
import { clamp, spring, stepSpring } from "./springs";

// Ported from the portfolio's Robot.tsx without React/R3F and the night theme.

const ROBOT_HEIGHT = 2.47; // model height in GLB units (feet at y = 0)
const FIT = 2.6; // model units that fill the requested size
const SOFT_PARTS = new Set([
  "Body",
  "Head",
  "ArmL",
  "ArmR",
  "Tummy",
  "EarL",
  "EarR",
]);

/** Soft round blob fading to transparent — the floor shadow (as in the portfolio). */
function radialTexture(rgb: string, alpha: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, `rgba(${rgb},${alpha})`);
  gradient.addColorStop(1, `rgba(${rgb},0)`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const shared = { uTime: { value: 0 }, uWobble: { value: 0 } };

/** "Marshmallow": matte standard material + soft rim light + jelly wobble on soft parts. */
function marshmallow(
  source: THREE.MeshStandardMaterial,
  soft: boolean,
  name: string,
): THREE.MeshStandardMaterial {
  const ink = name.startsWith("Eye") && !name.startsWith("EyeShine");
  const shine = name.startsWith("EyeShine");
  const material = new THREE.MeshStandardMaterial({
    color: source.color,
    roughness: ink || name === "Mouth" ? 0.35 : 0.78,
    metalness: 0,
    emissive: new THREE.Color(shine ? "#ffffff" : "#000000"),
    emissiveIntensity: shine ? 0.9 : 1,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uWobble = shared.uWobble;
    shader.uniforms.uRim = { value: ink ? 0 : 0.55 };
    shader.uniforms.uRimColor = { value: new THREE.Color("#fff1f7") };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uTime; uniform float uWobble;",
      )
      .replace(
        "#include <begin_vertex>",
        soft
          ? `#include <begin_vertex>
float w = sin(uTime * 9.0 + position.y * 7.0 + position.x * 3.0) * 0.6
        + sin(uTime * 13.0 - position.x * 6.0 + position.z * 5.0) * 0.4;
transformed += objectNormal * w * uWobble;`
          : "#include <begin_vertex>",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uRim; uniform vec3 uRimColor;",
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
vec3 vdir = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
float rim = pow(1.0 - clamp(dot(normal, vdir), 0.0, 1.0), 2.4);
totalEmissiveRadiance += uRimColor * rim * uRim;`,
      );
  };
  material.customProgramCacheKey = () => `marsh-${soft}-${ink}`;
  return material;
}

const FLY_POSE: PoseFrame = { l: -1.25, r: 1.25, headZ: 0, headY: 0 };
/** Flying arms only replace calm clips, never a reaction. */
const CALM_CLIPS = new Set(["idle", "lookAround", "dream"]);

/** Maps design coordinates to the three.js camera (screen px, origin at centre, y up). */
export interface ScreenMapping {
  toScreen(point: Point): Point;
  /** Screen px per design px. */
  scale: number;
  width: number;
  height: number;
}

export class RobotRig {
  /** Positioned + scaled. Holds the turning body and the (non-turning) floor shadow. */
  readonly object = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly squash = new THREE.Group();
  private readonly shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: radialTexture("43,36,64", 0.32),
      transparent: true,
      depthWrite: false,
    }),
  );
  private readonly parts;
  private readonly base;

  // All motion state. Position springs live in design coordinates.
  private readonly px = spring();
  private readonly py = spring();
  private readonly size = spring(0);
  private readonly jiggle = spring();
  private readonly lean = spring();
  private readonly turn = spring();
  private readonly spin = spring();
  private readonly headX = spring();
  private readonly headY = spring();
  private readonly headZ = spring();
  private readonly armL = spring();
  private readonly armR = spring();
  private readonly antennaX = spring();
  private readonly antennaZ = spring();
  private spinTarget = 0;
  private hop = 0;
  private hopVelocity = 0;
  private airborne = false;
  private wobble = 0;
  private previousVx = 0;
  private clipKey = "";
  private firedEvents = new Set<ClipEvent>();
  private happyUntil = 0;
  // gestures (design px)
  private pressing = false;
  private drag: Point | null = null;
  private blinkAt = 2000;
  private blinkEnd = 0;
  private winkUntil = 0;
  private placed = false;

  static async load(url: string): Promise<RobotRig> {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new RobotRig(gltf.scene);
  }

  private constructor(model: THREE.Object3D) {
    model.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.material = marshmallow(
          mesh.material as THREE.MeshStandardMaterial,
          SOFT_PARTS.has(mesh.name),
          mesh.name,
        );
      }
    });

    const get = (name: string) => model.getObjectByName(name)!;
    this.parts = {
      head: get("Head"),
      armL: get("ArmL"),
      armR: get("ArmR"),
      eyeL: get("EyeL"),
      eyeR: get("EyeR"),
      mouth: get("Mouth"),
      antenna: get("Antenna"),
    };
    this.base = {
      armL: this.parts.armL.rotation.clone(),
      armR: this.parts.armR.rotation.clone(),
      eyeL: this.parts.eyeL.position.clone(),
      eyeR: this.parts.eyeR.position.clone(),
      eyeScale: this.parts.eyeL.scale.clone(),
      mouthScale: this.parts.mouth.scale.clone(),
    };

    // squash & stretch pivots at the feet
    this.squash.position.y = -ROBOT_HEIGHT / 2;
    this.squash.add(model);
    this.body.add(this.squash);
    this.shadow.renderOrder = -1;
    this.object.add(this.shadow, this.body);
  }

  /** Current centre in design coordinates (for the hit area). */
  get position(): Point {
    return {
      x: this.px.x,
      y: this.py.x - (this.hop * ROBOT_HEIGHT * this.size.x) / FIT,
    };
  }

  /** Hit radius in design px. */
  get radius(): number {
    return this.size.x * 0.36;
  }

  // --- gestures (ported from the portfolio's RobotHitZone) ---

  /** Tap: jelly poke + happy eyes. */
  poke(now: number): void {
    this.jiggle.v -= 5.5;
    this.headZ.v += (Math.random() > 0.5 ? 1 : -1) * 7;
    this.antennaZ.v += (Math.random() > 0.5 ? 1 : -1) * 14;
    this.happyUntil = now + 750;
  }

  /** Double tap: jump with a full turn. */
  doublePoke(now: number): void {
    this.jump(2.6, true);
    this.happyUntil = now + 1200;
  }

  /** Mouse enters: small squish + wink. */
  hover(now: number): void {
    this.jiggle.v -= 2.2;
    this.antennaZ.v += 6;
    this.winkUntil = now + 260;
  }

  /** Finger/mouse held down on the robot: squashes while pressed. */
  setPressing(pressing: boolean): void {
    this.pressing = pressing;
  }

  /** Long press reached: the "hug" squish. */
  hug(): void {
    this.antennaX.v += 8;
  }

  /** Drag offset from the robot's spot (already rubber-banded), or null. */
  setDrag(offset: Point | null): void {
    this.drag = offset;
  }

  /** Let go after a drag or a hug: bounce back. */
  release(now: number, strength: number, hop: boolean): void {
    this.jiggle.v += 7 * strength;
    this.antennaZ.v += 12 * (Math.random() - 0.5) * 2;
    this.happyUntil = now + 600;
    if (hop) this.jump(2.4, false);
  }

  private jump(velocity: number, spin: boolean): void {
    if (this.airborne) return;
    this.hopVelocity = velocity; // robot heights per second
    this.airborne = true;
    this.jiggle.v += 5;
    if (spin) this.spinTarget += Math.PI * 2;
  }

  update(
    intent: RobotIntent,
    now: number,
    rawDt: number,
    motion: boolean,
    view: ScreenMapping,
  ): void {
    const t = now / 1000;
    const dt = Math.min(rawDt, 1 / 30);

    if (!this.placed || !motion) {
      this.px.x = intent.target.x;
      this.py.x = intent.target.y;
      this.size.x = intent.size;
      this.px.v = this.py.v = this.size.v = 0;
      this.placed = true;
    }

    // Clip events (jumps, turns) fire once when their moment passes.
    const clip = CLIPS[intent.clip];
    const key = `${intent.clip}@${intent.clipStartedAt}`;
    if (key !== this.clipKey) {
      this.clipKey = key;
      this.firedEvents.clear();
    }
    const progress = Number.isFinite(clip.duration)
      ? clamp((now - intent.clipStartedAt) / clip.duration, 0, 1)
      : 0;
    for (const event of clip.events ?? []) {
      if (event.at > progress || this.firedEvents.has(event)) continue;
      this.firedEvents.add(event);
      if (!motion) continue;
      if (event.jump) this.jump(event.jump, !!event.spin);
      if (event.jiggle) this.jiggle.v += event.jiggle;
      if (event.antenna) this.antennaZ.v += event.antenna;
    }

    if (motion) {
      // dragging: stiff spring towards the finger; otherwise soft jelly lag
      const k = this.drag ? 260 : 40;
      const c = this.drag ? 22 : 10;
      stepSpring(this.px, intent.target.x + (this.drag?.x ?? 0), k, c, dt);
      stepSpring(this.py, intent.target.y + (this.drag?.y ?? 0), k, c, dt);
      stepSpring(this.size, intent.size, 40, 12, dt);
    }

    // design px/s → the same thresholds the portfolio used in screen px
    const vx = this.px.v * view.scale;
    const vy = this.py.v * view.scale;
    const speed = Math.hypot(vx, vy);
    const accelX = (vx - this.previousVx) / Math.max(dt, 1e-3);
    this.previousVx = vx;
    const flying = motion && speed > 380 && !this.drag;

    if (this.airborne) {
      this.hopVelocity -= 9.5 * dt;
      this.hop += this.hopVelocity * dt;
      if (this.hop <= 0) {
        this.hop = 0;
        this.hopVelocity = 0;
        this.airborne = false;
        this.jiggle.v -= 6.5;
      }
    }

    const frame: PoseFrame = !motion
      ? CLIPS.idle.frame(0, 0)
      : flying && CALM_CLIPS.has(intent.clip)
        ? FLY_POSE
        : clip.frame(progress, t);

    if (motion) {
      let jiggleTarget = Math.sin(t * 2.2) * 0.018; // breathing
      jiggleTarget += frame.squash ?? 0;
      if (this.pressing && !this.drag) jiggleTarget = -0.3; // long-press squish
      const dragDistance = this.drag ? Math.hypot(this.drag.x, this.drag.y) : 0;
      jiggleTarget += clamp((dragDistance * view.scale) / 450, 0, 0.28); // taffy pull
      jiggleTarget += clamp(speed / 5000, 0, 0.14); // stretch while flying
      if (this.airborne)
        jiggleTarget += clamp(this.hopVelocity * 0.05, -0.1, 0.12);
      stepSpring(this.jiggle, jiggleTarget, 190, 7.5, dt);
    } else {
      this.jiggle.x = 0;
    }

    const wobbleTarget = motion
      ? clamp(Math.abs(this.jiggle.v) * 0.004, 0, 0.055)
      : 0;
    this.wobble +=
      (wobbleTarget - this.wobble) * (wobbleTarget > this.wobble ? 0.35 : 0.06);
    shared.uWobble.value = this.wobble;
    shared.uTime.value = t;

    // look direction relative to the robot (design px → -1..1), y up
    let lookX = 0;
    let lookY = 0;
    if (motion && intent.lookAt) {
      lookX = clamp((intent.lookAt.x - this.px.x) / 260, -1, 1);
      lookY = clamp(-(intent.lookAt.y - this.py.x) / 260, -1, 1);
    }

    const pose = frame;
    if (motion) {
      const dragLean = this.drag
        ? clamp(-this.drag.x * view.scale * 0.0025, -0.5, 0.5)
        : 0;
      stepSpring(
        this.lean,
        clamp(-vx * 0.0006, -0.4, 0.4) + dragLean + (pose.lean ?? 0),
        120,
        9,
        dt,
      );
      stepSpring(this.turn, lookX * 0.32, 60, 10, dt);
      stepSpring(this.spin, this.spinTarget, 26, 7, dt);
      stepSpring(this.headY, lookX * 0.5 + pose.headY, 110, 10, dt);
      stepSpring(this.headX, -lookY * 0.32, 110, 10, dt);
      stepSpring(this.headZ, pose.headZ, 140, 6, dt);
      stepSpring(this.armL, pose.l, 150, 9, dt);
      stepSpring(this.armR, pose.r, 150, 9, dt);
      // floppy antenna driven by body acceleration and head motion
      this.antennaZ.v +=
        (accelX * 0.0009 + this.headZ.v * 0.4) * dt * 60 * 0.016;
      stepSpring(
        this.antennaZ,
        clamp(-this.lean.x * 0.8, -0.6, 0.6),
        90,
        4.2,
        dt,
      );
      stepSpring(
        this.antennaX,
        clamp(-this.jiggle.x * 1.5 + this.hopVelocity * 0.04, -0.5, 0.5),
        90,
        4.5,
        dt,
      );
    }

    // --- apply transforms (screen px, origin at canvas centre, y up) ---
    const screen = view.toScreen({ x: this.px.x, y: this.py.x });
    const scale = (Math.max(this.size.x, 1) * view.scale) / FIT;
    const bob = motion ? Math.sin(t * 1.8) * 0.035 * ROBOT_HEIGHT * scale : 0;
    this.object.position.set(
      screen.x - view.width / 2,
      view.height / 2 - screen.y + this.hop * ROBOT_HEIGHT * scale + bob,
      0,
    );
    this.object.scale.setScalar(scale);
    this.body.rotation.set(0, this.turn.x + this.spin.x, this.lean.x);

    // floor shadow stays on the ground while the body hops and bobs
    const shrink = 1 / (1 + this.hop * 2.2);
    this.shadow.position.set(
      0,
      -ROBOT_HEIGHT / 2 - 0.05 - this.hop * ROBOT_HEIGHT - bob / scale,
      -1,
    );
    this.shadow.scale.set(
      1.5 * shrink * (1 - this.jiggle.x * 0.6),
      0.32 * shrink,
      1,
    );
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.9 * shrink;

    const stretch = 1 + this.jiggle.x;
    const thin = 1 / Math.sqrt(Math.max(stretch, 0.3));
    this.squash.scale.set(thin, stretch, thin);

    const { head, armL, armR, eyeL, eyeR, mouth, antenna } = this.parts;
    head.rotation.set(this.headX.x, this.headY.x, this.headZ.x);
    // raised arms swing forward so they don't hide behind the head
    const forward = (angle: number) =>
      -0.95 * clamp(Math.abs(angle) / 1.8, 0, 1);
    armL.rotation.set(
      this.base.armL.x + forward(this.armL.x),
      this.base.armL.y,
      this.base.armL.z + this.armL.x,
    );
    armR.rotation.set(
      this.base.armR.x + forward(this.armR.x),
      this.base.armR.y,
      this.base.armR.z + this.armR.x,
    );
    antenna.rotation.set(this.antennaX.x, 0, this.antennaZ.x);

    // eyes: follow, blink, happy squint, wink
    eyeL.position.set(
      this.base.eyeL.x + lookX * 0.045,
      this.base.eyeL.y + lookY * 0.035,
      this.base.eyeL.z,
    );
    eyeR.position.set(
      this.base.eyeR.x + lookX * 0.045,
      this.base.eyeR.y + lookY * 0.035,
      this.base.eyeR.z,
    );
    if (motion && now > this.blinkAt) {
      this.blinkEnd = now + 130;
      this.blinkAt = now + 2200 + Math.random() * 3200;
    }
    const blinking = motion && now < this.blinkEnd;
    const winking = motion && now < this.winkUntil;
    const happy = motion && (!!frame.happy || now < this.happyUntil);
    const open = (closed: boolean) => (closed ? 0.12 : happy ? 0.4 : 1);
    eyeL.scale.set(
      this.base.eyeScale.x,
      this.base.eyeScale.y * open(blinking || winking),
      this.base.eyeScale.z,
    );
    eyeR.scale.set(
      this.base.eyeScale.x,
      this.base.eyeScale.y * open(blinking),
      this.base.eyeScale.z,
    );
    mouth.scale.copy(this.base.mouthScale).multiplyScalar(happy ? 1.35 : 1);
  }
}
