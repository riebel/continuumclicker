# Continuum Clicker

> To boldly click where no one has clicked before.

An incremental space game. Click the ship to feed its reactors, buy upgrades that generate
energy on their own, and burn that energy to push from standard orbit all the way to
Warp 9.9999. Installable as an offline-capable PWA.

## Playing

- **Click the ship** (or focus it and press <kbd>Enter</kbd>/<kbd>Space</kbd>) for energy. 5% of
  clicks are critical and yield double.
- **Reactor upgrades** produce energy every second. Each purchase raises the next price by 15%.
- **The helm** sets your speed. Every level drains energy per second:
  - *white*: your reactors cover the drain, you can cruise forever,
  - *orange*: it drains your reserves; when they run dry the ship automatically drops to the
    fastest speed your reactors can sustain,
  - *grey*: not enough energy to engage.
- Progress is saved automatically in your browser (every 15 s and whenever you leave the page).
  The game keeps running while you are away, and tells you what happened when you come back.
- Save games from the original 2014 version are migrated automatically.

## Development

Requires Node.js 22.12 or newer (see `.nvmrc`).

```sh
npm install
npm run dev        # dev server with hot reload
npm run check      # lint + typecheck + tests
npm run build      # production build into dist/
npm run preview    # serve the production build
```

| Script               | What it does                                    |
| -------------------- | ----------------------------------------------- |
| `npm test`           | Run the test suite once (Vitest)                |
| `npm run test:watch` | Run tests in watch mode                         |
| `npm run lint`       | Lint and check formatting (Biome)               |
| `npm run format`     | Fix lint and formatting issues where possible   |
| `npm run typecheck`  | Type-check with TypeScript                      |

### Stack

- [Vite](https://vite.dev) + [React 19](https://react.dev) with the React Compiler, written in
  strict TypeScript
- [Zustand](https://zustand.docs.pmnd.rs) for game state
- [Tailwind CSS 4](https://tailwindcss.com) for styling
- [Motion](https://motion.dev) for animations
- [Zod](https://zod.dev) to validate save games
- [vite-plugin-pwa](https://vite-pwa-org.netlify.app) for installability and offline play
- [Vitest](https://vitest.dev) + [Testing Library](https://testing-library.com) for tests
- [Biome](https://biomejs.dev) for linting and formatting

### Project layout

```
src/
  game/         Framework-free game logic, fully unit tested
    content.ts    Upgrades, speed levels and constants: tweak the balance here
    engine.ts     Pure rules: buying, clicking, speed, and the time simulation
    format.ts     Number, duration and distance formatting
    save.ts       Versioned, validated save games (+ legacy migration)
    store.ts      Zustand store wiring the engine to time, storage and notices
  ui/           React components (HUD, panels, ship, starfield, menu, notices)
  App.tsx       Layout
```

The simulation in `engine.ts` (`advance`) is exact for any time step: the same code handles a
16 ms animation frame and a week of offline progress, including running out of energy halfway
through.

### Deployment

Every push to `master` is built and deployed to GitHub Pages by
`.github/workflows/deploy.yml`. Enable it once under **Settings → Pages → Source: GitHub
Actions**. The build uses relative paths, so `dist/` can also be served from any static host.

## License

[MIT](LICENSE) © Hagen Sommerkorn
