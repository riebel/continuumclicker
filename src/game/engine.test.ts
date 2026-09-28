import { describe, expect, it } from 'vitest'
import { COMETS, SPEED_LEVELS, SPEED_OF_LIGHT_KMH, UPGRADES } from './content'
import {
  advance,
  buyLaser,
  buyUpgrade,
  canEngage,
  catchComet,
  createAsteroid,
  createInitialState,
  engage,
  expectedHitEnergy,
  fire,
  type GameState,
  hitEnergy,
  milestoneMultiplier,
  netRate,
  nextMilestoneAt,
  nextVisualTierAt,
  production,
  speedLevelStatus,
  sustainableLevel,
  upgradeCost,
  visualTier,
  warpIntensity,
} from './engine'

const levelIndex = (id: string) => SPEED_LEVELS.findIndex((l) => l.id === id)
const drainOf = (id: string) => SPEED_LEVELS[levelIndex(id)]?.drain ?? Number.NaN

function withState(patch: Partial<GameState>): GameState {
  return { ...createInitialState(), ...patch }
}

const pick = ({ multiplier, duration }: { multiplier: number; duration: number }) => ({
  multiplier,
  duration,
})

describe('upgrades', () => {
  it('grows the cost by 15% per owned unit', () => {
    expect(upgradeCost({ baseCost: 100 }, 0)).toBe(100)
    expect(upgradeCost({ baseCost: 100 }, 2)).toBeCloseTo(132.25)
  })

  it('buys when affordable and charges the current price', () => {
    const state = withState({ energy: 20 })
    const next = buyUpgrade(state, 'avidyne-engine')
    expect(next.owned['avidyne-engine']).toBe(1)
    expect(next.energy).toBe(5)
    expect(state.owned['avidyne-engine']).toBe(0) // immutable
  })

  it('refuses purchases it cannot afford', () => {
    const state = withState({ energy: 14 })
    expect(buyUpgrade(state, 'avidyne-engine')).toBe(state)
  })

  it('sums production over all upgrades', () => {
    const state = withState({
      owned: { ...createInitialState().owned, 'avidyne-engine': 10, 'driver-coil': 2 },
    })
    expect(production(state)).toBeCloseTo(10 * 0.1 * 2 + 2 * 3)
  })
})

describe('production milestones', () => {
  it.each([
    [0, 1, 10],
    [9, 1, 10],
    [10, 2, 25],
    [25, 4, 50],
    [50, 8, null],
    [500, 8, null],
  ])('owning %d multiplies output by %d, next at %s', (owned, multiplier, next) => {
    expect(milestoneMultiplier(owned)).toBe(multiplier)
    expect(nextMilestoneAt(owned)).toBe(next)
  })
})

describe('ship modules', () => {
  it.each([
    [0, 0, 1],
    [1, 1, 5],
    [4, 1, 5],
    [5, 2, 10],
    [49, 4, 50],
    [50, 5, null],
    [500, 5, null],
  ])('owning %d unlocks tier %d, next at %s', (owned, tier, next) => {
    expect(visualTier(owned)).toBe(tier)
    expect(nextVisualTierAt(owned)).toBe(next)
  })
})

describe('mining laser', () => {
  const noCrit = () => 0.5
  const crit = () => 0.01

  it('earns energy per hit and damages the asteroid', () => {
    const { state, gained, critical, bonus, target } = fire(createInitialState(), noCrit)
    expect(gained).toBe(1)
    expect(critical).toBe(false)
    expect(bonus).toBe(0)
    expect(target.hp).toBe(3)
    expect(state.asteroid.hp).toBe(3)
    expect(state.energy).toBe(1)
    expect(state.clicks).toBe(1)
    expect(state.lifetimeEnergy).toBe(1)
  })

  it('multiplies critical hits', () => {
    const { gained, critical } = fire(createInitialState(), crit)
    expect(critical).toBe(true)
    expect(gained).toBe(3)
  })

  it('pays a break bonus and targets a new asteroid', () => {
    let state = withState({ asteroid: { kind: 'rock', hp: 1, maxHp: 4 } })
    const result = fire(state, noCrit)
    expect(result.target.hp).toBe(0)
    expect(result.bonus).toBe(4 * 0.5)
    expect(result.state.asteroidsMined).toBe(1)
    expect(result.state.asteroid.hp).toBeGreaterThan(0)
    state = result.state
    expect(state.energy).toBe(1 + 2)
  })

  it('scales hits with gross reactor output', () => {
    const idle = withState({ owned: { ...createInitialState().owned, 'driver-coil': 10 } }) // 60 eps
    expect(hitEnergy(idle)).toBeCloseTo(1 + 0.06 * 60)
    const flying = { ...idle, speedLevel: SPEED_LEVELS.length - 1 }
    expect(hitEnergy(flying)).toBe(hitEnergy(idle))
  })

  it('makes crystal asteroids worth more per hit', () => {
    const state = withState({ asteroid: { kind: 'crystal', hp: 10, maxHp: 10 } })
    expect(fire(state, noCrit).gained).toBe(3)
  })

  it('creates rocks with 3 to 6 hit points and rare crystals', () => {
    expect(createAsteroid(() => 0.01)).toEqual({ kind: 'crystal', hp: 10, maxHp: 10 })
    expect(createAsteroid(() => 0.07).hp).toBe(3)
    expect(createAsteroid(() => 0.999).hp).toBe(6)
  })

  it('upgrades the laser with energy, up to its cap', () => {
    const rich = withState({ energy: 1e12 })
    const amplified = buyLaser(rich, 'laser-amplifier')
    expect(amplified.lasers['laser-amplifier']).toBe(1)
    expect(amplified.energy).toBe(1e12 - 50)
    expect(hitEnergy(amplified)).toBeGreaterThan(hitEnergy(rich))
    expect(expectedHitEnergy(amplified)).toBeGreaterThan(expectedHitEnergy(rich))

    const maxed = withState({ energy: 1e12, lasers: { ...rich.lasers, 'precision-scanner': 10 } })
    expect(buyLaser(maxed, 'precision-scanner')).toBe(maxed)
    expect(buyLaser(withState({ energy: 10 }), 'laser-amplifier').lasers['laser-amplifier']).toBe(0)
  })

  it('averages to the simulated value over many shots', () => {
    let state = withState({
      lasers: { 'laser-amplifier': 3, 'precision-scanner': 4, 'crystal-resonator': 2 },
    })
    let seed = 1
    const random = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    const expected = expectedHitEnergy(state)
    const shots = 200_000
    for (let i = 0; i < shots; i++) state = fire(state, random).state
    expect(state.energy / shots).toBeCloseTo(expected, 0)
  })
})

describe('speed levels', () => {
  it('derives the drain from the fraction of c', () => {
    expect(drainOf('stop')).toBe(0)
    expect(drainOf('orbit')).toBe(1)
    expect(drainOf('warp-1')).toBe(1125)
  })

  it('classifies levels by what the ship can afford', () => {
    const state = withState({
      energy: 50,
      owned: { ...createInitialState().owned, 'driver-coil': 1 }, // 3 eps
    })
    expect(speedLevelStatus(state, 0)).toBe('engaged')
    expect(speedLevelStatus(state, levelIndex('orbit'))).toBe('sustainable')
    expect(speedLevelStatus(state, levelIndex('impulse-1-8'))).toBe('burst') // drain 36
    expect(speedLevelStatus(state, levelIndex('impulse-1-4'))).toBe('locked') // drain 71
  })

  it('only engages levels that are not locked', () => {
    const state = withState({ energy: 40 })
    expect(engage(state, levelIndex('impulse-1-8')).speedLevel).toBe(levelIndex('impulse-1-8'))
    expect(canEngage(state, levelIndex('warp-1'))).toBe(false)
    expect(engage(state, levelIndex('warp-1'))).toBe(state)
  })

  it('finds the fastest sustainable level', () => {
    expect(sustainableLevel(0)).toBe(0)
    expect(sustainableLevel(1)).toBe(levelIndex('orbit'))
    expect(sustainableLevel(1200)).toBe(levelIndex('warp-1'))
  })

  it('maps speed to a 0..1 warp intensity', () => {
    expect(warpIntensity(createInitialState())).toBe(0)
    expect(warpIntensity(withState({ speedLevel: SPEED_LEVELS.length - 1 }))).toBe(1)
  })
})

describe('comets', () => {
  const coils = { ...createInitialState().owned, 'driver-coil': 1 } // 3 eps
  const overdrive = COMETS.rewards.overdrive
  const frenzy = COMETS.rewards['laser-frenzy']

  it('grants an overdrive that multiplies production until it runs out', () => {
    const { state, reward } = catchComet(withState({ owned: coils }), () => 0)
    expect(reward).toEqual({ kind: 'overdrive', ...pick(overdrive) })
    expect(production(state)).toBe(3 * overdrive.multiplier)
    expect(state.cometsCaught).toBe(1)

    // Exact across the expiry: boosted for the rest of the buff, normal afterwards.
    const { state: later } = advance(state, overdrive.duration + 10)
    expect(later.energy).toBeCloseTo(3 * overdrive.multiplier * overdrive.duration + 3 * 10)
    expect(later.buffs).toEqual([])
    expect(production(later)).toBe(3)
  })

  it('refreshes a buff caught again instead of stacking it', () => {
    let state = catchComet(withState({ owned: coils }), () => 0).state
    state = advance(state, 20).state
    state = catchComet(state, () => 0).state
    expect(state.buffs).toEqual([
      { kind: 'overdrive', ...pick(overdrive), remaining: overdrive.duration },
    ])
  })

  it('grants a laser frenzy that multiplies hits', () => {
    const normal = withState({})
    const { state } = catchComet(normal, () => 0.6)
    expect(state.buffs[0]?.kind).toBe('laser-frenzy')
    expect(hitEnergy(state)).toBe(hitEnergy(normal) * frenzy.multiplier)
  })

  it('pays a windfall, capped by minutes of production', () => {
    const { bankShare, productionSeconds, hits } = COMETS.rewards.windfall
    const rich = withState({ owned: coils, energy: 1e9 })
    const { state, reward } = catchComet(rich, () => 0.99)
    const expected = 3 * productionSeconds + hits * hitEnergy(rich)
    expect(reward).toEqual({ kind: 'windfall', energy: expected })
    expect(state.energy).toBe(1e9 + expected)

    const poor = withState({ owned: coils, energy: 100 })
    expect(catchComet(poor, () => 0.99).reward).toEqual({
      kind: 'windfall',
      energy: 100 * bankShare + hits * hitEnergy(poor),
    })
  })
})

describe('crystal veins', () => {
  it('guarantee a critical hit', () => {
    const noCrit = () => 0.99
    expect(fire(createInitialState(), noCrit).critical).toBe(false)
    expect(fire(createInitialState(), noCrit, { vein: true }).critical).toBe(true)
  })
})

describe('advance', () => {
  it('accumulates production and distance', () => {
    const state = withState({
      speedLevel: levelIndex('warp-1'),
      energy: 0,
      owned: { ...createInitialState().owned, 'impulse-control-system': 10 }, // 1400 eps
    })
    const { state: next, downshifted } = advance(state, 3600)
    expect(downshifted).toBe(false)
    expect(next.energy).toBeCloseTo((1400 - 1125) * 3600)
    expect(next.distance).toBeCloseTo(SPEED_OF_LIGHT_KMH)
    expect(next.lifetimeEnergy).toBeCloseTo(1400 * 3600)
  })

  it('is independent of the step size', () => {
    const state = withState({
      speedLevel: levelIndex('impulse-1-8'),
      energy: 100,
      owned: { ...createInitialState().owned, 'avidyne-engine': 5 }, // 0.5 eps, drain 36
    })
    const once = advance(state, 10).state
    let stepped = state
    for (let i = 0; i < 1000; i++) stepped = advance(stepped, 0.01).state
    expect(stepped.energy).toBeCloseTo(once.energy, 6)
    expect(stepped.distance).toBeCloseTo(once.distance, 3)
    expect(stepped.speedLevel).toBe(once.speedLevel)
  })

  it('drops to a sustainable speed when the reserves run dry, keeping the distance so far', () => {
    const state = withState({
      speedLevel: levelIndex('impulse-1-8'), // drain 36
      energy: 330,
      owned: { ...createInitialState().owned, 'driver-coil': 1 }, // 3 eps → net -33
    })
    const { state: next, downshifted } = advance(state, 3600)
    expect(downshifted).toBe(true)
    expect(next.speedLevel).toBe(levelIndex('orbit'))

    const burstSeconds = 330 / 33
    const orbit = SPEED_LEVELS[levelIndex('orbit')]
    const expectedDistance =
      (0.03125 * SPEED_OF_LIGHT_KMH * burstSeconds) / 3600 +
      ((orbit?.c ?? 0) * SPEED_OF_LIGHT_KMH * (3600 - burstSeconds)) / 3600
    expect(next.distance).toBeCloseTo(expectedDistance, 3)
    expect(next.energy).toBeCloseTo((3 - 1) * (3600 - burstSeconds))
  })

  it('stops completely without production', () => {
    const state = withState({ speedLevel: levelIndex('orbit'), energy: 5 })
    const { state: next } = advance(state, 100)
    expect(next.speedLevel).toBe(0)
    expect(next.energy).toBe(0)
  })

  it('ignores negative or invalid durations', () => {
    const state = withState({ energy: 5 })
    expect(advance(state, -10).state.energy).toBe(5)
    expect(advance(state, Number.NaN).state.energy).toBe(5)
  })

  it('never produces negative energy', () => {
    const state = withState({ speedLevel: SPEED_LEVELS.length - 1, energy: 1e9 })
    expect(advance(state, 1e7).state.energy).toBe(0)
    expect(netRate(state)).toBeLessThan(0)
  })
})

it('ships unique ids', () => {
  const ids = [...UPGRADES.map((u) => u.id), ...SPEED_LEVELS.map((l) => l.id)]
  expect(new Set(ids).size).toBe(ids.length)
})
