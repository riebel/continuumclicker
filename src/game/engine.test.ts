import { describe, expect, it } from 'vitest'
import { SPEED_LEVELS, SPEED_OF_LIGHT_KMH, UPGRADES } from './content'
import {
  advance,
  buyUpgrade,
  canEngage,
  click,
  createInitialState,
  engage,
  type GameState,
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

describe('clicking', () => {
  it('adds click energy', () => {
    const { state, gained, critical } = click(createInitialState(), () => 0.5)
    expect(gained).toBe(1)
    expect(critical).toBe(false)
    expect(state.energy).toBe(1)
    expect(state.clicks).toBe(1)
    expect(state.lifetimeEnergy).toBe(1)
  })

  it('doubles energy on a critical click', () => {
    const { gained, critical } = click(createInitialState(), () => 0.01)
    expect(critical).toBe(true)
    expect(gained).toBe(2)
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
