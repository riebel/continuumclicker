import { describe, expect, it } from 'vitest'
import { DARK_MATTER } from './content'
import {
  createInitialState,
  darkMatterBonus,
  darkMatterFor,
  type GameState,
  jumpSector,
  pendingDarkMatter,
  production,
} from './engine'
import { ACTIVE, simulate } from './simulate'

const HOUR = 3600

function withState(patch: Partial<GameState>): GameState {
  return { ...createInitialState(1), ...patch }
}

describe('dark matter', () => {
  it('grows with the cube root of all energy ever generated', () => {
    expect(darkMatterFor(0)).toBe(0)
    expect(darkMatterFor(DARK_MATTER.base - 1)).toBe(0)
    expect(darkMatterFor(DARK_MATTER.base)).toBe(1)
    expect(darkMatterFor(DARK_MATTER.base * 27)).toBe(3)
  })

  it('only counts what has not been collected yet', () => {
    const state = withState({ lifetimeEnergy: DARK_MATTER.base * 64, darkMatter: 3 })
    expect(pendingDarkMatter(state)).toBe(1)
  })

  it('boosts production', () => {
    const coils = { ...createInitialState().owned, 'driver-coil': 1 }
    expect(production(withState({ owned: coils, darkMatter: 5 }))).toBeCloseTo(3 * 1.5)
    expect(darkMatterBonus(withState({ darkMatter: 5 }))).toBeCloseTo(1 + 5 * DARK_MATTER.bonus)
  })
})

describe('sector jump', () => {
  const late = withState({
    energy: 1e12,
    lifetimeEnergy: DARK_MATTER.base * 1000,
    owned: { ...createInitialState().owned, 'impulse-jet': 40 },
    lasers: { 'laser-amplifier': 9, 'precision-scanner': 10, 'crystal-resonator': 4 },
    modules: ['chain-laser'],
    equipped: ['chain-laser'],
    visited: ['home', 's0-0'],
    darkMatter: 4,
    clicks: 500,
    asteroidsMined: 90,
    cometsCaught: 7,
  })

  it('starts over in a new sector, keeping dark matter and lifetime statistics', () => {
    const next = jumpSector(late, 77)
    expect(next).toEqual({
      ...createInitialState(77),
      darkMatter: 10,
      jumps: 1,
      lifetimeEnergy: late.lifetimeEnergy,
      clicks: 500,
      asteroidsMined: 90,
      cometsCaught: 7,
    })
  })

  it('is refused while it would not collect anything', () => {
    const early = withState({ lifetimeEnergy: DARK_MATTER.base / 2 })
    expect(jumpSector(early, 77)).toBe(early)
  })
})

describe('prestige pacing', () => {
  const first = simulate(ACTIVE, 12 * HOUR)
  const at = (hours: number) => first.income.findLast((x) => x.time <= hours * HOUR)

  it('pays nothing in the first hour, so nobody resets by accident early on', () => {
    expect(darkMatterFor(at(1)?.lifetime ?? 0)).toBe(0)
  })

  it('makes a jump after a few hours worth it: the next run catches up in half the time', () => {
    const jumpAt = at(4)
    if (!jumpAt) throw new Error('no sample')
    const start = { ...createInitialState(), darkMatter: darkMatterFor(jumpAt.lifetime) }
    const second = simulate(ACTIVE, 4 * HOUR, start)
    const catchUp = second.income.find((x) => x.production >= jumpAt.production)?.time
    expect(catchUp).toBeDefined()
    expect(catchUp).toBeGreaterThan(0.3 * 4 * HOUR)
    expect(catchUp).toBeLessThan(0.6 * 4 * HOUR)
  })

  it('places the best reset window at four to six hours with the mounted arsenal', () => {
    const perHour = (hours: number) => darkMatterFor(at(hours)?.lifetime ?? 0) / hours
    expect(perHour(2)).toBeLessThan(perHour(4))
    expect(perHour(2)).toBeLessThan(perHour(6))
    expect(perHour(12)).toBeLessThan(perHour(4))
    expect(perHour(12)).toBeLessThan(perHour(6))
  })
})
