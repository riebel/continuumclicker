# Continuum Clicker

> To boldly click where no one has clicked before.

An incremental space game. Click the ship to feed its reactors, buy upgrades that generate
energy on their own, and burn that energy to push from standard orbit all the way to
Warp 9.9999. Installable as an offline-capable PWA.

## Playing

- **Click the ship** (or focus it and press <kbd>Enter</kbd>/<kbd>Space</kbd>) for energy. 5% of
  clicks are critical and yield double.
- **Reactor upgrades** produce energy every second. Each purchase raises the next price by 15%.
  Every upgrade also has a **module on the 3D ship** that grows through five tiers (at 1, 5, 10, 25
  and 50 owned): extra engines, generator bands, coils, capacitor banks, sensors, decks, manoeuvring
  jets, field-matrix conduits, nacelles, an exposed reactor core and finally turrets and a spinal
  cannon. The dots next to each upgrade show how many are installed.
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
- [three.js](https://threejs.org) via [React Three Fiber](https://r3f.docs.pmnd.rs), drei and
  postprocessing (HDR bloom) for the 3D scene
- [Blender](https://www.blender.org) (scripted through its Python module) for the ship model
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
  scene/        The WebGL layer (lazy loaded): ship, exhaust shaders, warp starfield, bloom
  ui/           React components (HUD, panels, ship button, menu, notices)
  App.tsx       Layout
blender/
  build_ship.py Procedural, modular ship model → glTF
  render.py     Cycles stills: PWA icons and the no-WebGL fallback poster
```

The simulation in `engine.ts` (`advance`) is exact for any time step: the same code handles a
16 ms animation frame and a week of offline progress, including running out of energy halfway
through.

### The 3D ship

The ship is modelled in code: `blender/build_ship.py` builds the greebled hull and every upgrade
module tier as separate objects, bakes ambient occlusion into vertex colours and exports glTF. Each
module object carries `{"module": <upgrade id>, "tier": 1-5}` in its glTF extras; empties marked
`{"nozzle": …, "radius": …}` locate the engine exhausts.

The engines really glow: the throats are emissive geometry and the exhaust plumes are shaders
(hot core, taper, flicker, Mach diamonds at high thrust), both brighter than 1.0 so the HDR bloom
pass picks them up, and a point light at the engine cluster lights the hull. Thrust follows the
engaged speed level and spikes briefly on every click. Browsers without WebGL 2 get a Cycles
render of the ship instead.

To change the model, edit the script and rebuild (requires Python 3.11 and Blender's Python module):

```sh
pip install bpy==5.0.1
npm run model                                   # → src/assets/ship.glb (meshopt compressed)
python blender/render.py preview.png --tier 3   # Cycles still with modules up to tier 3
```

### Deployment

Every push to `master` is built and deployed to GitHub Pages by
`.github/workflows/deploy.yml`. Enable it once under **Settings → Pages → Source: GitHub
Actions**. The build uses relative paths, so `dist/` can also be served from any static host.

## License

[MIT](LICENSE) © Hagen Sommerkorn
