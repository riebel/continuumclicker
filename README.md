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
- **The arsenal** adds six unlockable weapons alongside the pulse laser: an overcharging plasma
  cannon, a crystal-piercing railgun, Tesla chain lightning, a freeze-and-shatter cryo beam,
  missile salvos and a singularity that collapses an asteroid. Each has five upgrade levels.
  Select the Arsenal tab to install or improve weapons. Purchased systems remain fitted to
  separate hardpoints and fire automatically alongside the pulse laser.
  All weapons benefit from your laser upgrades. Hold the ship button to keep firing.
- **Ship transformations** start with your first reactor upgrade. Combined module tiers unlock
  seven hull forms: Scout, Interceptor, Frigate, Destroyer, Battlecruiser, Dreadnought and Star
  fortress. Swept wings, engine pods, armour, command decks, spinal rails and reactor rings deploy
  around the hull, and installed weapons get their own visible mounts and shot effects. The refit
  bar below the ship shows progress toward the next form. Weapons and selection persist in saves;
  existing saves automatically receive the pulse laser.
- **Boss encounters** intercept an actively mining upgraded ship after about 150 seconds of
  active mining, then roughly every 330 seconds of mining between encounters. A nine-second
  warning precedes the Nacre Leviathan or Obsidian Dreadnought. Keep clicking/holding the same
  firing surface: hardpoints automatically acquire the boss's physical weak point. Three phases
  accelerate incoming attacks; focus fire interrupts telegraphed attacks, Tesla disrupts charge,
  Cryo slows it and railguns penetrate capital armour. Singularities deal bounded rupture damage.
  Shields protect the ship; **Disengage** resumes mining with cargo/upgrades intact. Encounters
  never advance offline. Bounties and lifetime victories persist; active fights do not.
- **Balance** now includes all mounted weapons, target HP/overkill, crystal distribution,
  charge cycles, combat duration and lost mining time. Reactor contribution to mining is 4.5%,
  plus 0.15% per amplifier level. Extra simultaneous fracture damage recovers diminishing energy,
  so additional guns improve mining without multiplying income uncontrollably. The economy bot
  reaches sustainable maximum warp in about 9.4 hours when active, 8.7 hours with successful
  optional bounty hunting, and 33.3 hours when idle; these are ideal simulations, not deadlines.
  Travel rings and reactor unlock pacing remain covered by tests; prestige favours 4–6 hour runs.
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
  build_refits.py Blender hull transformations and detailed weapon assemblies → glTF
  build_arsenal.py Additive hardpoints, paired weapons and missile batteries → glTF
  build_projectiles.py Detailed flight models with emissive cores and exhaust markers → glTF
  build_mining.py Sculpted asteroid variants, crystals and fragments → glTF
  build_bosses.py Articulated cosmic organism and hostile siege vessel, baked PBR atlases → glTF
  render.py     Cycles stills: PWA icons and the no-WebGL fallback poster
  run.mjs       Runs those scripts with a locally installed Blender
```

The simulation in `engine.ts` (`advance`) is exact for any time step: the same code handles a
16 ms animation frame and a week of offline progress, including running out of energy halfway
through.

### The 3D ship

The ship is modelled in code after the original 2014 artwork: `blender/build_ship.py` lofts the
hull from rounded superellipse sections (two stacked engine barrels, a neck ringed by drums, a
tapering spine that forks into twin booms) and covers it in layers of curved armour plates,
transverse ribs, slats, pipes and hatches that follow the surface. It builds every upgrade module
tier as a separate object, bakes ambient occlusion into vertex colours and exports glTF. Each
module object carries `{"module": <upgrade id>, "tier": 1-5}` in its glTF extras; empties marked
`{"nozzle": …, "radius": …}` locate the engine exhausts.

`blender/build_refits.py` shares the original modelling tools and metal palette to build six
cumulative hull refits and seven weapon assemblies. Curved armour, cooling collars, bores,
hydraulics and recessed emitters are geometry, with ambient occlusion baked per installation
stage into vertex colours. The exported `refits.glb` uses `form`, `weapon`, `weaponTier` and
`muzzle` extras. Its hull refits share ship coordinates and the installation animation;
the original alternative weapon meshes are superseded by the additive arsenal below.
The build also saves an editable Blender scene at
`blender/build/refits.raw.blend`.

`blender/build_arsenal.py` builds eleven permanent hardpoints: a forward pulse turret, twin
shoulder plasma cannons, a ventral railgun, twin dorsal Tesla coils, two underside cryo emitters,
two outboard missile batteries and an aft dorsal singularity projector. Armoured saddles,
hydraulic braces and fixed bearings remain attached to the hull while each weapon aims independently.
All purchased systems stay installed. Missile upgrades add two launch cells per battery at each
stage, from twelve total at L1 to twenty-eight at L5; other weapons gain capacitor/cooling banks.
The asset uses the original hull's modelling tools and metals, with 32-sample Cycles AO baked
into vertex colours. `arsenal.glb` is about 3 MB, with its editable scene at
`blender/build/arsenal.raw.blend`. Extras identify `weapon`, `weaponTier`, `mount`, `weaponMount`,
`weaponSystem` and each physical `muzzle`.

One input fires a coordinated volley at the acquired target. The pulse fires every time;
installed auxiliary systems automatically fire at staggered intervals, retaining independent
plasma/singularity charge and cryo freeze/shatter state. Damage and rewards are clamped to one
target per input. Each system fires from its own Blender muzzle markers, including both missile
batteries. The Arsenal installs/upgrades systems; no weapon switching is required.

`blender/build_projectiles.py` models the Hydra missile, plasma containment capsule and tungsten
rail dart in Blender, with plated casings, bevelled swept fins, seeker lenses, cooling rings and
real engine throats. It bakes 64-sample AO per model and exports a 129 KB `projectiles.glb` plus
`blender/build/projectiles.raw.blend`. Runtime pools reuse the meshes/materials; Hydra and plasma
exhausts use the same layered nozzle shaders as the ship. Narrow view-dependent beam volumes,
ion wakes and short turbulent flashes replace solid cones, plain orbs and oversized impact rings.
Each volley keeps a separate live target track, so rapid fire cannot redirect an older projectile
to the newly acquired rock. Retired tracks preserve their final impact position. Cryo deposits
reflective frost on the actual asteroid surface rather than drawing a wire cage around it.

Mining uses five detailed Blender targets streaming against the ship's heading. Belt flow
spools up/down with the engaged drive, with a capped rate that leaves targets readable at warp.
Approach in depth produces perspective growth; arrivals/exits fade at the ends of each lane.
Destroying or passing a rock acquires an approaching neighbour with time left to mine it.
The bounded target cache retains individual HP, crystal type and unexpired crystal locks when
acquisition order changes; a pass awards no energy or destroyed-asteroid credit. The fixed firing
surface still supports clicking, holding and keyboard activation. Crystal locks are consumed by
normal firing, so bonuses do not require chasing moving targets. Each weapon mount follows the
acquired target, plasma/missiles home on moving targets and hold acquisition until impact, and
mineral fragments are pulled into the cargo intake. Tesla's chain points at the actual next
target and damages its retained HP. Ice stops a rock's tumble while it still passes the ship;
singularity shots pull the surrounding field. Reduced motion removes belt streaming, keeps
acquisition immediate and removes the moving salvage paths.

`blender/build_mining.py` sculpts four reusable cratered asteroid meshes, a mineral prism and a
rock fragment, baking mineral strata and contact shadows into vertex colours. The compressed
`mining.glb` is about 269 KB; no meshes are allocated on each hit. Its editable source scene is
saved to `blender/build/mining.raw.blend`.

`blender/build_bosses.py` builds both encounter models with the original ship's modelling tools.
The Leviathan has layered chitin, skeletal tendons, a recessed radial iris and eight independently
rigged limbs. Its 2K colour and 1K tangent-normal/roughness atlases are baked in Cycles; data maps
are compressed as lossless WebP. The dreadnought has plated siege shoulders, recessed hangars,
six twin turrets, an exposed dorsal reactor and native engine throats. Both use 48-sample vertex
AO. Extras identify boss roots, articulated parts, physical weak points and twelve enemy muzzle
outlets. Meshopt compression keeps the asset within the offline cache's per-file budget.
The editable Blender scene is `blender/build/bosses.raw.blend`, with the two models side by side.
The runtime reuses all geometry, drives tendril animation, locks beams/missiles to the native
weak-point markers and fires siege batteries from the actual gun barrels. Combat HUDs use HP
bars rather than asteroid pips, and reserve scene space on mobile. Reduced motion removes
approach/limb travel and softens effects; the accessible firing surface stays in place.

The engines really glow: the throats are emissive geometry and the exhaust plumes are shaders
(hot core, taper, flicker, Mach diamonds at high thrust), both brighter than 1.0 so the HDR bloom
pass picks them up, and a point light at the engine cluster lights the hull. Thrust follows the
engaged speed level and spikes briefly on every click. Browsers without WebGL 2 get a Cycles
render of the ship instead.

To change the model, edit the script and rebuild with [Blender](https://www.blender.org/download/)
5 or later (found in its default install location, or set `BLENDER` to its executable):

```sh
npm run model                                         # → src/assets/ship.glb (meshopt compressed)
npm run model:refits                                  # → src/assets/refits.glb + editable .blend
npm run model:arsenal                                 # → src/assets/arsenal.glb + editable .blend
npm run model:projectiles                             # → src/assets/projectiles.glb + editable .blend
npm run model:mining                                  # → src/assets/mining.glb + editable .blend
npm run model:bosses                                  # → src/assets/bosses.glb + editable .blend + PBR atlases
node blender/run.mjs render.py preview.png --tier 3   # Cycles still with modules up to tier 3
```

`blender/render.py` also lists the commands that render the poster and the PWA icons.

### Deployment

Every push to `master` is built and deployed to GitHub Pages by
`.github/workflows/deploy.yml`. Enable it once under **Settings → Pages → Source: GitHub
Actions**. The build uses relative paths, so `dist/` can also be served from any static host.

## License

[MIT](LICENSE) © Hagen Sommerkorn
