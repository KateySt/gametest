import * as THREE from "three";

/**
 * The three.js side of the shared WebGL context (PixiJS guide "Mixing PixiJS
 * and Three.js"). three creates the canvas + context; Pixi is initialised on
 * the same context, so there is one canvas and one frame loop.
 *
 * Frame order: Pixi renders the game (and clears), then this layer draws the
 * robot on top. Each renderer resets the shared GL state before drawing,
 * otherwise each would trust a state cache the other one has changed.
 */
export class RobotLayer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  // Orthographic camera in screen px: 1 unit = 1 CSS pixel, origin at centre.
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);

  constructor() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      stencil: true, // Pixi masks may use the stencil buffer
    });
    this.renderer.autoClear = false; // Pixi already cleared the frame
    this.camera.position.z = 1000;

    const key = new THREE.DirectionalLight("#fff3ea", 1.7);
    key.position.set(-300, 500, 600);
    const back = new THREE.DirectionalLight("#d8ccff", 0.9);
    back.position.set(400, 120, -300);
    this.scene.add(
      new THREE.HemisphereLight("#fff6ee", "#d9ccff", 1.45),
      key,
      back,
    );
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  get context(): WebGL2RenderingContext {
    return this.renderer.getContext() as WebGL2RenderingContext;
  }

  /** Keep three's viewport in sync with the canvas size Pixi manages. */
  resize(width: number, height: number, resolution: number): void {
    this.renderer.setPixelRatio(resolution);
    this.renderer.setSize(width, height, false);
    Object.assign(this.camera, {
      left: -width / 2,
      right: width / 2,
      top: height / 2,
      bottom: -height / 2,
    });
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.resetState();
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
  }
}
