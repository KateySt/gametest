# Sweet Slots — PixiJS v8 + TypeScript + Vite

A small 3×3 slot machine with 5 paylines, in the pastel style of the portfolio, with a 3D robot companion. The goal is to show a clean, best-practice structure for a PixiJS game.

```bash
npm install
npm run dev      # http://localhost:8080 — SPIN button or Space; press again while spinning to quick-stop
npm run build    # lint + typecheck + production build into dist/
```

Stack: **pixi.js 8** (rendering), **three.js** (3D robot), **gsap** (tweens), **Vite** (bundling), strict TypeScript.
Scaffolded with the official `npm create pixi.js@latest -- --template bundler-vite`.

## Architecture

```
src/
  config/slotConfig.ts   data: symbols, weights, payouts, paylines, bet      (no pixi)
  config/theme.ts        design tokens from the portfolio: colours, fonts, radii
  core/                  MODEL — plain TypeScript                            (no pixi)
    rng.ts               seeded generator + weighted pick
    paylines.ts          win evaluation per payline
    SlotMachine.ts       balance, bet, spin() → SpinResult
    StateMachine.ts      finite state machine
  view/                  VIEW — Pixi only
    Reel.ts, ReelSet.ts  reels, mask, blur, quick stop, card frame
    WinPresenter.ts      win line, symbol pulse, ✦ sparkles (pooled)
    Hud.ts               balance/win pills, SPIN/STOP button
    symbolTextures.ts    SVG from public/symbols + pastel tile → one texture
    Background.ts        cream page, pastel blobs, paper grain
    softTextures.ts      soft shadows and blobs baked with Canvas 2D
    layout.ts            design resolution and sizes
  game/Game.ts           CONTROLLER — connects model and view, emits events
  robot/                 3D ROBOT COMPANION (model from the portfolio)
    RobotBrain.ts        brain: lane around the machine, idle schedule, reactions, gaze (no three/pixi)
    clips.ts             animation clips: pose over time + events (jump, turn, antenna)
    Trip.ts              one trip along the lane: rounded corners, arc-length sampling, ease-in-out
    ThoughtBubble.ts     the "dream" cloud with three symbols in a row
    springs.ts           springs for the "jelly" motion
    RobotRig.ts          body: loads robot.glb, marshmallow shader, poses, gaze, blinking
    RobotLayer.ts        three.js renderer in the WebGL context shared with Pixi
    RobotHitArea.ts      invisible Pixi circle over the robot: gesture recognition
    Robot.ts             wiring: brain → body → layer + input + game events
  main.ts                composition root: init, ticker, resize
```

### Why it is built this way

**1. Pixi is the screen, not the game.** Rules, money and randomness live in `core/`, which never imports `pixi.js`.
The logic can be tested in Node in milliseconds, the art can be replaced completely, and the model could move to a server (in real slots the server always decides the result).

**2. The result is known BEFORE the animation.** `machine.spin()` returns the final grid instantly; the reels only "travel" to it.
The anti-pattern — spinning and reading where the reels stopped — depends on frame rate and cannot be tested or reproduced.

**3. A state machine instead of flags.** `idle → spinning → presenting → idle`.
With flags like `isSpinning`, `isShowingWin`, … you eventually get a double spin or a stuck button; the state machine makes such transitions impossible ([Game Programming Patterns: State](https://gameprogrammingpatterns.com/state.html)).

**4. The RNG is injected.** `SlotMachine` takes `random: () => number`: `Math.random` in the game, a seeded generator in tests, so spins are deterministic.

**5. Data is separate from code.** More hearts or a bigger robot payout → change numbers in `slotConfig.ts`; colours → `theme.ts`; art → SVGs in `public/symbols`.

**6. The controller is the only place that knows everyone.** `Game.spin()` reads like a script: ask the model → animate → present the win. Views make no decisions; the model knows nothing about time.

**7. Fixed design resolution (720×1000).** Everything is laid out in one coordinate space; the root container is scaled to fit the window.

**8. Events instead of direct calls.** `Game.events` (`spinStart`, `reelStopped`, `reelsStopped`, `spinEnd`) — `Game` does not know the robot exists. The event bus appeared when the second listener did.

## Quick stop

Pressing SPIN again (the button reads STOP while spinning) or Space → `Game` sees the `spinning` state and calls `reelSet.stopNow()`:
each reel's GSAP tween gets `progress(1)` — it jumps to its end, the final grid shows at once, and the normal flow continues.

## Robot companion

The robot rests at spots around the machine and makes **trips** between them along a U-shaped lane outside the card
(beside SPIN → up the left side → across the top → down the right side → beside SPIN). A trip is a path with rounded
corners, travelled with ease-in-out (`Trip.ts`); the body rides the path exactly (no spring lag), so it never cuts across the reels.
On narrow screens the side lanes hug the card (the body may overlap the card's padding or be cropped by a few px at the
screen edge, never the reels); on wide screens they move out into the side margins and the robot gets bigger there.

**Where it goes — never a fixed loop:**
- **Towards the player:** when the cursor settles near another spot (0.7 s, with hysteresis) and the robot has rested ≥ 2.5 s, it walks over, a bit eager.
- **Lazy wander** when the cursor is idle: after a random 6–14 s wait, mostly to a near spot, never straight back where it came from,
  at a random tempo; on 30 % of trips that pass a corner it stops there for a look around before continuing.
- While travelling it looks where it is going (or at the cursor); at rest it fidgets.

```
idle ──spin──▶ spinStart ("let's go!") ──▶ idle, eyes follow each reel stopping left to right
idle | spin ──win──▶ smallWin (< 8× bet, clap) | win (hop) | bigWin (≥ 20×, flip) ──▶ idle
loss → nothing, stays idle
```

**Idle layers:** always — breathing, bobbing, blinking, following the cursor with its eyes · trips as above ·
at rest — a random fidget (look around, stretch, hop; never the same twice in a row) · when the player is idle, **once per idle period**:
10 s — flies to a top corner and dreams (a thought cloud in the band above the reels with three hearts/stars/… in a row;
rarely the robot-head jackpot) → 20 s — waves → 25 s — flies beside SPIN and points at it.
**It never spins on its own** — only the player spends the balance
(regulated markets banned autoplay: [SBC News](https://sbcnews.co.uk/featurednews/2021/02/02/ukgc-bans-online-slots-autoplay-and-quickspin-features/)).
Any input interrupts attention seeking at once.

Animations are **clips** (`clips.ts`): duration + pose at time t + events. The brain decides which clip plays; the body follows with springs.

**Gestures** (as on the portfolio, but on Pixi events): hover — wink · click — jelly poke · double click — jump with a turn ·
long press — "hug", release — hop · drag — stretches like taffy, release — springs back. Gestures layer on top of any clip.

**How 3D lives inside 2D** (official guide [Mixing PixiJS and Three.js](https://pixijs.com/8.x/guides/third-party/mixing-three-and-pixi)):
three.js creates the canvas and the WebGL context; Pixi is initialised on the same one (`canvas`, `context`, `preference: "webgl"`).
One canvas and one ticker: Pixi draws the game (priority `LOW`), then the robot is drawn on top (`UTILITY`).
Each engine resets the GL state (`resetState()`) before rendering, otherwise Pixi masks and filters break.
The cost: no WebGPU, about +150 KB gzip in the bundle.

With `prefers-reduced-motion` the robot does not drift or wobble.

## Design

Palette, fonts (Bricolage Grotesque + Inter via `@fontsource`, no requests to Google) and "soft cards" come from the portfolio, light theme.
Symbols are sweets: heart, star, macaron, cloud, crystal and the robot head (jackpot).
Fonts are loaded before any text is created (`document.fonts.load`), otherwise canvas text renders with a fallback font.

### Performance (following the official Performance Tips)

- Symbols (SVG + tile) are drawn once and baked into textures → the reels are plain `Sprite`s that batch.
- Soft shadows, pastel blobs and grain are drawn once with Canvas 2D instead of Pixi filters every frame.
- ✦ sparkles share one `GraphicsContext` and are pooled.
- The dream bubble reuses the reels' baked symbol textures: measured 33 WebGL draw calls per frame with and without it (most of them are the 3D robot's meshes).
- Each reel has only `rows + 1` sprites: they are re-textured while scrolling; nothing is created or destroyed.
- The mask is a rectangle (the cheapest kind, GPU scissor).
- The `BlurFilter` is attached only while spinning, then `filters = null`.
- Balance and win use `BitmapText` (a plain `Text` re-rasterizes and re-uploads on every change).
- The button has `hitArea` + `interactiveChildren = false` — a cheap hit test. Without `hitArea` the container would not receive clicks at all.
- GSAP runs on Pixi's ticker — one clock for the whole game.

### What to add next (and when)

- Real art → a spritesheet via `Assets` (+ AssetPack for compression/@0.5x).
- Sound → `@pixi/sound`. Buttons/sliders → `@pixi/ui`.
- Several screens (loading, menu, game) → that is when a scene manager is needed.
- Production robot → a 2D Spine version (faster, no three.js); `RobotBrain` stays unchanged.

In dev mode the app is exposed to the PixiJS DevTools extension (`globalThis.__PIXI_APP__`).

## Claude skill

[.claude/skills/pixijs-game/SKILL.md](.claude/skills/pixijs-game/SKILL.md) — PixiJS v8 rules and this architecture; picked up automatically in this project.
The official PixiJS skills can be installed alongside: `npx skills add https://github.com/pixijs/pixijs-skills`.

## Sources

- PixiJS v8 guides: https://pixijs.com/8.x/guides (Performance Tips, Render Loop, Architecture)
- Official PixiJS skills: https://github.com/pixijs/pixijs-skills
- Game Programming Patterns — State, Game Loop: https://gameprogrammingpatterns.com
- Fix Your Timestep: https://gafferongames.com/post/fix_your_timestep/
- GSAP: https://gsap.com/docs/v3/
