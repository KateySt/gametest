# Cherry Slots — PixiJS v8 + TypeScript + Vite

Маленький слот-автомат 3×3, 5 линий выплат. Задача — показать правильную структуру игры на PixiJS.

```bash
npm install
npm run dev      # http://localhost:8080, SPIN — кнопка или пробел
npm run build    # lint + typecheck + production-сборка в dist/
```

Stack: **pixi.js 8** (рендер), **gsap** (твины), **Vite** (сборка), TypeScript strict.
Проект создан официальным `npm create pixi.js@latest -- --template bundler-vite`.

## Архитектура

```
src/
  config/slotConfig.ts   данные: символы, веса, выплаты, линии, ставка   (без pixi)
  core/                  МОДЕЛЬ — чистый TypeScript                      (без pixi)
    rng.ts               сидируемый генератор + взвешенный выбор
    paylines.ts          подсчёт выигрышей по линиям
    SlotMachine.ts       баланс, ставка, spin() → SpinResult
    StateMachine.ts      конечный автомат состояний
  view/                  ПРЕДСТАВЛЕНИЕ — только Pixi
    Reel.ts, ReelSet.ts  барабаны, маска, blur
    WinPresenter.ts      линия выигрыша + пульсация символов
    Hud.ts               баланс, выигрыш, кнопка SPIN
    symbolTextures.ts    временная графика (эмодзи → текстура)
    layout.ts            «дизайн-разрешение» и размеры
  game/Game.ts           КОНТРОЛЛЕР — связывает модель и view
  main.ts                точка сборки: init, ticker, resize
```

### Почему так

**1. Pixi — это экран, а не игра.** Правила, деньги, рандом — в `core/`, который не импортирует `pixi.js`.
Поэтому логика тестируется в Node за миллисекунды, графику можно полностью заменить, а модель при желании перенести на сервер (в настоящих слотах результат всегда считает сервер).

**2. Результат известен ДО анимации.** `machine.spin()` мгновенно возвращает итоговую сетку, и только потом барабаны «доезжают» до неё.
Анти-паттерн — крутить барабаны и смотреть, где остановились: результат зависит от FPS, его нельзя протестировать и воспроизвести.

**3. Конечный автомат вместо флагов.** Состояния `idle → spinning → presenting → idle`.
С флагами `isSpinning`, `isShowingWin`, … рано или поздно возникает «двойной спин» или зависшая кнопка; автомат делает такие переходы невозможными ([Game Programming Patterns: State](https://gameprogrammingpatterns.com/state.html)).

**4. RNG внедряется снаружи.** `SlotMachine` принимает `random: () => number`. В игре — `Math.random`, в тестах — сид, и спины детерминированы.

**5. Данные отдельно от кода.** Хочешь чаще вишенки или больше за 💎 — меняешь числа в `slotConfig.ts`.

**6. Контроллер — единственное место, знающее всех.** `Game.spin()` читается как сценарий: спросить модель → анимировать → показать выигрыш. View не принимают решений, модель не знает о времени.

**7. Фиксированное дизайн-разрешение (720×1000).** Всё верстается в одних координатах, корневой контейнер масштабируется под окно.

### Производительность (по официальным Performance Tips)

- Символы рисуются один раз и «запекаются» в текстуры → барабаны — это обычные `Sprite`, которые батчатся.
- На барабан всего `rows + 1` спрайтов: при прокрутке им меняется текстура, ничего не создаётся и не удаляется.
- Маска — прямоугольник (самая дешёвая, GPU scissor).
- `BlurFilter` висит только во время вращения, потом `filters = null`.
- Баланс и выигрыш — `BitmapText` (обычный `Text` перерисовывается и грузится в GPU при каждом изменении).
- У кнопки `hitArea` + `interactiveChildren = false` — дешёвый хит-тест. Без `hitArea` контейнер вообще не ловит клики (на этом споткнулись при проверке).
- GSAP идёт от тикера Pixi — одни часы на всю игру.

### Что добавлять дальше (и когда)

- Настоящая графика → спрайтшит через `Assets` (+ AssetPack для сжатия/@0.5x).
- Звук → `@pixi/sound`. Кнопки/слайдеры → `@pixi/ui`.
- Несколько экранов (загрузка, меню, игра) → тогда появится менеджер сцен. Шина событий — когда подписчиков станет больше одного. Не раньше.

## Skill для Claude

[.claude/skills/pixijs-game/SKILL.md](.claude/skills/pixijs-game/SKILL.md) — правила PixiJS v8 и эта архитектура, подхватывается автоматически в этом проекте.
Официальные скиллы от команды PixiJS можно поставить рядом: `npx skills add https://github.com/pixijs/pixijs-skills`.

## Источники

- PixiJS v8 guides: https://pixijs.com/8.x/guides (Performance Tips, Render Loop, Architecture)
- Официальные скиллы PixiJS: https://github.com/pixijs/pixijs-skills
- Game Programming Patterns — State, Game Loop: https://gameprogrammingpatterns.com
- Fix Your Timestep: https://gafferongames.com/post/fix_your_timestep/
- GSAP: https://gsap.com/docs/v3/
