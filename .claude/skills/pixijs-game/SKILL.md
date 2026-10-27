---
name: pixijs-game
description: Use when building, structuring or reviewing a 2D browser game with PixiJS v8 (pixi.js) and TypeScript — scaffolding a project, choosing a folder architecture, writing reels/slot machines, mixing three.js 3D models into Pixi, tweens, game loops, input, resizing, text, masks or filters, or when a Pixi button ignores clicks, a Vite build fails on top-level await, or v7-style code (new Application({...}), app.view, interactive = true) appears.
---

# PixiJS v8 game development

## Core principle

**Pixi is the view, not the game.** Rules, randomness, money and state live in
plain TypeScript that never imports `pixi.js`. Pixi only draws what that
model already decided. Everything below follows from this.

## Architecture

```
src/
  config/   numbers designers tune (symbols, weights, payouts, paylines). No pixi.
  core/     pure model: RNG, rules, StateMachine. No pixi. Unit-tested with vitest.
  view/     Pixi Containers. Display + animation only. Never decide outcomes.
  game/     controller: the one place that knows model AND views; owns the flow FSM.
  main.ts   composition root: init app, build textures, wire objects, resize.
```

Dependency direction is one-way: `view → core types`, `game → core + view`,
`core → config`. `core` importing `pixi.js` or `gsap` is a bug.

| Decision | Why |
|---|---|
| Model separate from view | Logic testable in Node in milliseconds; art can be swapped; the same model can later run on a server. |
| Decide the outcome **before** animating | The animation is a presentation of a known result. Slots: `machine.spin()` returns the grid, then reels `spinTo(grid)`. Never "stop where the reel happened to land". |
| Inject the RNG (`() => number`) | Seeded RNG ⇒ deterministic tests and reproducible bugs. |
| One finite state machine for game flow | Replaces `isSpinning`/`isShowingWin` boolean soup; illegal actions (spin while spinning) become impossible. See gameprogrammingpatterns.com/state. |
| Fixed design resolution + scaled root container | Layout in one coordinate space; letterbox to any screen. |
| Data in `config/` | Balancing changes numbers, not code. |

Add an event bus, scene manager or ECS only when a second scene or many
interacting entities actually exist — not up front.

## v8 API rules (most common agent mistakes)

| Wrong (v7 / guess) | Right (v8) |
|---|---|
| `new Application({ width })` | `const app = new Application(); await app.init({ ... })` |
| `app.view` | `app.canvas` (only after `await app.init`) |
| `sprite.interactive = true` | `sprite.eventMode = "static"` (`"none"` to disable) |
| `on("click")` for buttons | `on("pointertap")` — works for mouse and touch |
| `Texture.from("url")` before load | `await Assets.load(...)` / bundles, then `Texture.from(alias)` |
| `graphics.beginFill(c).drawRect(...)` | `graphics.rect(...).fill(c)` (shape first, then fill/stroke) |
| `new BlurFilter(8)` | `new BlurFilter({ strength: 8, quality: 2 })` |
| `generateTexture(obj)` loosely | `renderer.generateTexture({ target, resolution })` |

## Setup

```bash
npm create pixi.js@latest my-game -- --template bundler-vite
npm i gsap && npm i -D vitest
```

- Top-level `await app.init()` in `main.ts` **breaks `vite build`** unless
  `build.target: "es2022"` (and tsconfig `target`/`lib` ES2022).
- `resizeTo: window`, `autoDensity: true`, `resolution: Math.min(devicePixelRatio, 2)`
  — resolution 3 on phones is 9× pixels for little visible gain.
- Fit a fixed design size: on `app.renderer.on("resize")`, `scale = min(w/DW, h/DH)`, center the root.

## Rendering and performance

Profile first; Pixi handles a lot out of the box. When it matters:

- **Sprites batch, everything else costs.** Prefer spritesheets (TexturePacker /
  AssetPack). Placeholder art drawn with Graphics/Text: bake once with
  `renderer.generateTexture`, then use Sprites.
- **Reuse, don't recreate.** A reel needs `rows + 1` sprites that get re-textured
  as they scroll — never create/destroy sprites per symbol. Pool short-lived objects.
- **Text:** canvas `Text` re-rasterizes and re-uploads on every change → use
  `BitmapText` for balance/score/win counters. `Text` is fine for static labels.
- **Masks:** axis-aligned rectangle Graphics mask = scissor (cheapest). Sprite masks are slowest.
- **Filters** add a render pass each: attach only while needed (`filters = [blur]`
  during spin, `filters = null` after); set `filterArea` if bounds are known.
- **Child order:** group same-kind objects / blend modes; interleaving breaks batches.
- **Events:** `interactiveChildren = false` on containers with no interactive
  children, **but then the container itself is only hittable via `hitArea`**:

  ```ts
  button.eventMode = "static";
  button.interactiveChildren = false;
  button.hitArea = new Rectangle(0, 0, w, h); // without this, clicks silently do nothing
  ```

- **Destroy:** `removeChild` then `destroy({ children: true })`; destroying many
  textures — spread over frames. Recreating the app: `app.destroy({ releaseGlobalResources: true })`.

## Animation and time

- Use **GSAP** for tweens (eases like `back.out` give the reel "bounce"), and
  `await gsap.to(...)` — tweens are thenable, so flows read as `async` steps.
- One clock: drive GSAP from Pixi's ticker so pausing the app pauses tweens:

  ```ts
  gsap.ticker.remove(gsap.updateRoot);
  app.ticker.add((t) => gsap.updateRoot(t.lastTime / 1000));
  ```

- Frame-based motion in the ticker uses `ticker.deltaTime` (≈1 at 60fps) or
  `deltaMS`; never assume 60 fps (120 Hz screens, throttled background tabs).
- Physics-like simulation needing determinism → fixed timestep with an
  accumulator (Gaffer on Games, "Fix Your Timestep"). A slot machine does not need it.

## Mixing three.js (3D) into a Pixi game

Official guide: https://pixijs.com/8.x/guides/third-party/mixing-three-and-pixi

- three creates canvas + context (`new THREE.WebGLRenderer({ antialias: true, stencil: true })`,
  `autoClear = false`); Pixi inits on it: `app.init({ preference: "webgl", canvas, context })`.
  WebGPU cannot share the context.
- One loop: Pixi renders at `UPDATE_PRIORITY.LOW`; add the three render at
  `UPDATE_PRIORITY.UTILITY` (after) and call `app.renderer.resetState()` in a NORMAL-priority
  callback (before). three side: `resetState(); clearDepth(); render()`. Missing resets break masks/filters.
- Keep three's size in sync: on `app.renderer.on("resize")` → `setPixelRatio(resolution); setSize(w, h, false)`.
- Orthographic camera in CSS px (origin centre, y up) so `root.toGlobal(designPoint)` maps directly.
- Clicks on a 3D object: an invisible Pixi `Container` with a `Circle` hitArea that follows it — no DOM overlay.
- Keep behaviour (brain/FSM) free of three and Pixi; only the rig touches three.

## Debugging

- `if (import.meta.env.DEV) globalThis.__PIXI_APP__ = app;` — enables the PixiJS DevTools extension
  and lets you inspect the scene from the console.
- A hidden/background tab can stop `requestAnimationFrame` entirely: "animation stuck" may be the
  environment, check frame rate before debugging code.

## Slot-machine recipe

1. `SlotMachine.spin()` (core): deduct bet → weighted-random grid `[reel][row]` → evaluate paylines → credit win → return `SpinResult`.
2. Controller: `idle → spinning` → `await reelSet.spinTo(result.grid)` → `presenting` → `await winPresenter.show(wins)` → `idle`.
3. Reel view: a strip `[pad, ...target, ...fillers, ...current, pad]`; tween a float `offset` from the "current" window to the target; sprite `k` sits at `y = (k - offset) * cell`. Later reels get more fillers and longer durations so they stop left to right. Blur strength ∝ scroll speed.
4. HUD only emits intent (`onSpin`) and displays numbers it is given.

## Common mistakes

- Game rules inside Pixi classes or ticker callbacks → untestable, entangled.
- Picking the result from where the animation stopped → unfair, unreproducible.
- Booleans for flow state → double-spins and stuck UI.
- `Math.random` hard-wired → flaky tests. (Real-money games need certified server-side RNG — never client-side.)
- Creating `Text`/`Graphics` per frame or per symbol; leaving filters attached forever.
- Reading `app.screen`/`app.canvas` before `await app.init()`.

## References

- Official docs: https://pixijs.com/8.x/guides — esp. Performance Tips, Render Loop, Architecture Overview, Events
- Official agent skills (install alongside this one): https://github.com/pixijs/pixijs-skills
- Scaffolder: `npm create pixi.js@latest` (https://pixijs.com/8.x/guides/getting-started/quick-start)
- State pattern: https://gameprogrammingpatterns.com/state.html · Game loop: https://gameprogrammingpatterns.com/game-loop.html
- Fixed timestep: https://gafferongames.com/post/fix_your_timestep/
- GSAP docs: https://gsap.com/docs/v3/
- three.js docs: https://threejs.org/docs/
