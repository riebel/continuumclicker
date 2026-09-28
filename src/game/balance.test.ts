import { describe, expect, it } from 'vitest'
import { UPGRADES } from './content'
import { ACTIVE, IDLE, longestWait, simulate } from './simulate'

/**
 * Pacing targets. If a content change breaks one of these, the game feels different: rethink
 * the change rather than loosening the test.
 */
const MINUTE = 60
const HOUR = 60 * MINUTE

const active = simulate(ACTIVE, 3 * 24 * HOUR)
const idle = simulate(IDLE, 3 * 24 * HOUR)
const unlockTimes = (sim: typeof active) =>
  UPGRADES.map((u) => sim.firstPurchaseAt[u.id] ?? Number.POSITIVE_INFINITY)

describe('content curve', () => {
  it('makes every tier more expensive and slower to pay back than the one before', () => {
    for (const [i, upgrade] of UPGRADES.entries()) {
      const previous = UPGRADES[i - 1]
      if (!previous) continue
      expect(upgrade.baseCost).toBeGreaterThan(previous.baseCost)
      expect(upgrade.baseCost / upgrade.eps).toBeGreaterThan(previous.baseCost / previous.eps)
    }
  })
})

describe('active play', () => {
  it('unlocks the second and third reactor within minutes', () => {
    const [, second, third] = unlockTimes(active)
    expect(second).toBeLessThan(1 * MINUTE)
    expect(third).toBeLessThan(5 * MINUTE)
  })

  it('unlocks a new tier every 35 minutes at first, and all of them within 5 hours', () => {
    const times = unlockTimes(active)
    for (const [i, time] of times.entries()) {
      if (time < 2 * HOUR) expect(time - (times[i - 1] ?? 0)).toBeLessThan(35 * MINUTE)
    }
    expect(Math.max(...times)).toBeLessThan(5 * HOUR)
  })

  it('always has a purchase in reach', () => {
    expect(longestWait(active.purchases, 1 * HOUR)).toBeLessThan(7 * MINUTE)
    expect(longestWait(active.purchases, 8 * HOUR)).toBeLessThan(30 * MINUTE)
  })

  it('earns two to three times the reactor output by mining', () => {
    for (const { time, production, total } of active.income) {
      if (time < 10 * MINUTE) continue
      expect(total / production).toBeGreaterThan(1.6)
      expect(total / production).toBeLessThan(3.5)
    }
  })

  it('maxes out every laser upgrade that has a cap', () => {
    expect(active.state.lasers['precision-scanner']).toBe(10)
    expect(active.state.lasers['crystal-resonator']).toBe(10)
  })

  it('reaches sustained maximum warp in about half a day', () => {
    expect(active.maxWarpAt).not.toBeNull()
    expect(active.maxWarpAt).toBeGreaterThan(8 * HOUR)
    expect(active.maxWarpAt).toBeLessThan(18 * HOUR)
  })
})

describe('idle play', () => {
  it('never gets stuck', () => {
    expect(Math.max(...unlockTimes(idle))).toBeLessThan(6 * HOUR)
  })

  it('reaches sustained maximum warp after about a day, not sooner', () => {
    expect(idle.maxWarpAt).not.toBeNull()
    expect(idle.maxWarpAt).toBeGreaterThan(24 * HOUR)
    expect(idle.maxWarpAt).toBeLessThan(40 * HOUR)
  })
})
