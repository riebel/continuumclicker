import { describe, expect, it } from 'vitest'
import {
  ASTEROIDS,
  MODULE_EFFECTS,
  MODULE_SLOTS,
  SPEED_LEVELS,
  SPEED_OF_LIGHT_KMH,
  VISITS,
} from './content'
import {
  advance,
  buyModule,
  createInitialState,
  crystalChance,
  drain,
  equip,
  fire,
  type GameState,
  hitEnergy,
  income,
  isScanned,
  position,
  production,
  setCourse,
  unequip,
} from './engine'
import { generateSector, HOME_ID, type StarSystem } from './sector'

const SEED = 4242
const sector = generateSector(SEED)
const levelIndex = (id: string) => SPEED_LEVELS.findIndex((l) => l.id === id)
const kmh = (id: string) => (SPEED_LEVELS[levelIndex(id)]?.c ?? 0) * SPEED_OF_LIGHT_KMH
const coils = { ...createInitialState().owned, 'driver-coil': 20 } // 3 × 20 × 2 = 120 eps

function withState(patch: Partial<GameState>): GameState {
  return { ...createInitialState(SEED), owned: coils, ...patch }
}

function system(predicate: (s: StarSystem) => boolean): StarSystem {
  const found = sector.systems.find(predicate)
  if (!found) throw new Error('no such system in the test sector')
  return found
}

const near = system((s) => s.ring === 0 && s.kind === 'belt')
const derelict = system((s) => s.kind === 'derelict' && s.find !== null)
const world = system((s) => s.kind === 'world' && s.offers.length > 0)

/** Seconds to fly `km` at a speed level. */
const secondsFor = (km: number, id: string) => (km * 3600) / kmh(id)

describe('travel', () => {
  it('starts docked at home', () => {
    const state = createInitialState(SEED)
    expect(state.location).toBe(HOME_ID)
    expect(state.visited).toEqual([HOME_ID])
    expect(position(state)).toEqual({ x: 0, y: 0 })
  })

  it('arrives exactly, drops out of warp and pays the first visit', () => {
    const state = { ...setCourse(withState({}), near.id), speedLevel: levelIndex('impulse-1-8') }
    expect(state.location).toBeNull()
    expect(state.course?.length).toBeCloseTo(near.distance)

    const trip = secondsFor(near.distance, 'impulse-1-8')
    const { state: next, arrivals } = advance(state, trip + 100)
    expect(next.location).toBe(near.id)
    expect(next.course).toBeNull()
    expect(next.speedLevel).toBe(0)
    expect(next.distance).toBeCloseTo(near.distance, 3)
    expect(next.visited).toContain(near.id)

    const reward = Math.max(VISITS.firstVisitMinimum, 120 * VISITS.firstVisitSeconds)
    expect(arrivals).toEqual([
      { system: near.id, firstVisit: true, energy: reward, module: null, overdrive: false },
    ])
    // 120 eps all along, minus the drive while flying, plus the reward.
    const flying = (120 - drain(state)) * trip
    expect(next.energy).toBeCloseTo(flying + 120 * 100 + reward, 1)
  })

  it('arrives at the same moment regardless of the step size', () => {
    const state = { ...setCourse(withState({}), near.id), speedLevel: levelIndex('impulse-1-8') }
    const trip = secondsFor(near.distance, 'impulse-1-8')
    const once = advance(state, trip * 1.5).state
    let stepped = state
    for (let i = 0; i < 300; i++) stepped = advance(stepped, (trip * 1.5) / 300).state
    expect(stepped.location).toBe(near.id)
    expect(stepped.energy).toBeCloseTo(once.energy, 3)
    expect(stepped.distance).toBeCloseTo(once.distance, 3)
  })

  it('pays the first-visit reward only once', () => {
    const state = withState({ visited: [HOME_ID, near.id] })
    const trip = { ...setCourse(state, near.id), speedLevel: levelIndex('impulse-1-8') }
    const { arrivals } = advance(trip, secondsFor(near.distance, 'impulse-1-8') + 1)
    expect(arrivals[0]).toMatchObject({ firstVisit: false, energy: 0 })
  })

  it('can change course mid-flight, starting from where the ship is', () => {
    const funded = withState({ energy: 1e9 })
    let state = { ...setCourse(funded, world.id), speedLevel: levelIndex('warp-1') }
    state = advance(state, 60).state
    const midway = position(state)
    expect(Math.hypot(midway.x, midway.y)).toBeCloseTo(kmh('warp-1') / 60, -3)

    state = setCourse(state, HOME_ID)
    expect(state.course).toMatchObject({ fromX: midway.x, fromY: midway.y, to: HOME_ID })
    expect(state.course?.length).toBeCloseTo(Math.hypot(midway.x, midway.y))
  })

  it('ignores courses to unknown systems or to where the ship already is', () => {
    const state = withState({})
    expect(setCourse(state, 'nowhere')).toBe(state)
    expect(setCourse(state, HOME_ID)).toBe(state)
  })

  it('salvages modules from derelicts', () => {
    const state = withState({ location: derelict.id })
    const trip = { ...setCourse(withState({}), derelict.id), speedLevel: SPEED_LEVELS.length - 1 }
    const { state: next, arrivals } = advance(trip, 1e7)
    expect(arrivals[0]?.module).toBe(derelict.find)
    expect(next.modules).toEqual([derelict.find])
    // Salvage pays extra on top of the visit.
    const prod = production(state)
    expect(arrivals[0]?.energy).toBeCloseTo(
      prod * (VISITS.firstVisitSeconds + VISITS.salvageSeconds),
    )
  })

  it('scans nearby systems and hides the far ones until the engines can reach them', () => {
    const far = system((s) => s.ring === SECTOR_LAST)
    expect(isScanned(withState({}), near)).toBe(true)
    expect(isScanned(withState({}), far)).toBe(false)
    expect(isScanned(withState({ visited: [HOME_ID, far.id] }), far)).toBe(true)
  })
})

const SECTOR_LAST = Math.max(...sector.systems.map((s) => s.ring))

describe('modules', () => {
  const offer = world.offers[0]
  const docked = withState({ location: world.id, energy: 1e15 })

  it('are sold at worlds, once', () => {
    if (!offer) throw new Error('test world has no offer')
    const bought = buyModule(docked, offer.module)
    expect(bought.modules).toEqual([offer.module])
    expect(bought.energy).toBe(1e15 - offer.price)
    expect(buyModule(bought, offer.module)).toBe(bought)
    // Only where they are offered, and only with enough energy.
    expect(buyModule(withState({ energy: 1e15 }), offer.module).modules).toEqual([])
    expect(buyModule({ ...docked, energy: 0 }, offer.module).modules).toEqual([])
  })

  it('fit into a limited number of slots', () => {
    let state = withState({
      modules: ['chain-laser', 'crystal-scanner', 'mining-drones', 'comet-lure'],
    })
    for (const id of state.modules) state = equip(state, id)
    expect(state.equipped).toHaveLength(MODULE_SLOTS)
    state = unequip(state, 'chain-laser')
    state = equip(state, 'comet-lure')
    expect(state.equipped).toEqual(['crystal-scanner', 'mining-drones', 'comet-lure'])
    expect(equip(withState({}), 'chain-laser').equipped).toEqual([])
  })

  const fitted = (...ids: GameState['equipped']) => withState({ modules: ids, equipped: ids })

  it('chain laser: the next asteroid starts weaker', () => {
    const state = fitted('chain-laser')
    const breaking = { ...state, asteroid: { kind: 'rock' as const, hp: 1, maxHp: 3 } }
    const next = fire(breaking, () => 0.99).state.asteroid // A 6-hp rock without the laser.
    expect(next.hp).toBe(6 - MODULE_EFFECTS.chainLaserDamage)
    expect(next.maxHp).toBe(6)
  })

  it('crystal scanner and belts make crystals more common', () => {
    const base = ASTEROIDS.crystal.chance
    expect(crystalChance(withState({}))).toBe(base)
    expect(crystalChance(fitted('crystal-scanner'))).toBe(
      base * MODULE_EFFECTS.crystalScannerChance,
    )
    expect(crystalChance(withState({ location: near.id }))).toBe(base * VISITS.beltCrystalChance)
    expect(hitEnergy(withState({ location: near.id }))).toBe(
      hitEnergy(withState({})) * VISITS.beltHitMultiplier,
    )
  })

  it('mining drones earn energy, also while away', () => {
    const state = fitted('mining-drones')
    expect(income(state)).toBeGreaterThan(production(state))
    const away = advance(state, 3600).state
    expect(away.energy).toBeCloseTo(income(state) * 3600, 0)
  })

  it('warp field tuner lowers the drain', () => {
    const flying = { ...fitted('warp-field-tuner'), speedLevel: levelIndex('warp-1') }
    expect(drain(flying)).toBe((SPEED_LEVELS[levelIndex('warp-1')]?.drain ?? 0) * 0.75)
  })
})
