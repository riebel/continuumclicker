import { describe, expect, it } from 'vitest'
import { SECTOR_RINGS, SPEED_LEVELS, SPEED_OF_LIGHT_KMH, UPGRADES, WEAPONS } from './content'
import { expectedCometBoost, sustainableLevel } from './engine'
import { ACTIVE, IDLE, longestWait, simulate } from './simulate'

/**
 * Pacing targets. If a content change breaks one of these, the game feels different: rethink
 * the change rather than loosening the test.
 */
const MINUTE = 60
const HOUR = 60 * MINUTE

const active = simulate(ACTIVE, 3 * 24 * HOUR)
const idle = simulate(IDLE, 3 * 24 * HOUR)
const hunter = simulate({ ...ACTIVE, bosses: true }, 3 * 24 * HOUR)
const unlockTimes = (sim: typeof active) =>
  UPGRADES.map((u) => sim.firstPurchaseAt[u.id] ?? Number.POSITIVE_INFINITY)

/** When a trip of `km` from home first takes at most 15 minutes at a sustainable speed. */
function reachableAt(sim: typeof active, km: number): number {
  const sample = sim.income.find(({ production }) => {
    const c = SPEED_LEVELS[sustainableLevel(production)]?.c ?? 0
    return c > 0 && (km * 3600) / (c * SPEED_OF_LIGHT_KMH) <= 15 * MINUTE
  })
  return sample?.time ?? Number.POSITIVE_INFINITY
}

describe('sector map', () => {
  // Each ring opens up as the engines get faster: a steady trickle of new destinations.
  const deadlines = [10 * MINUTE, 30 * MINUTE, HOUR, 1.5 * HOUR, 3 * HOUR, 18 * HOUR]

  it('brings every ring within a 15 minute trip in turn', () => {
    let previous = 0
    for (const [i, ring] of SECTOR_RINGS.entries()) {
      const near = reachableAt(active, ring.minKm)
      const far = reachableAt(active, ring.maxKm)
      expect(near, `ring ${i}`).toBeGreaterThanOrEqual(previous)
      expect(far, `ring ${i}`).toBeLessThanOrEqual(deadlines[i] ?? 0)
      previous = near
    }
  })

  it('keeps the whole sector reachable for idle players too', () => {
    const last = SECTOR_RINGS.at(-1)?.maxKm ?? 0
    expect(reachableAt(idle, last)).toBeLessThan(40 * HOUR)
  })
})

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

  it('keeps a complete mounted arsenal within the new active-income envelope', () => {
    for (const { time, production, total } of active.income) {
      if (time < 10 * MINUTE) continue
      expect(total / production).toBeGreaterThan(1.8)
      expect(total / production).toBeLessThan(4.5)
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

describe('optional bounty hunting', () => {
  it('rewards victories without making them necessary for progression', () => {
    expect(hunter.maxWarpAt).not.toBeNull()
    expect(hunter.maxWarpAt).toBeLessThan(active.maxWarpAt ?? 0)
    expect(hunter.maxWarpAt).toBeGreaterThan((active.maxWarpAt ?? 0) * 0.75)
    expect(active.maxWarpAt).toBeLessThan(14 * HOUR)
  })
  it('keeps every auxiliary weapon affordable within the first hour', () => {
    for (const w of WEAPONS) {
      if (w.id === 'pulse') continue
      const sample = active.income.find((i) => i.time > 50 * MINUTE)
      expect(sample?.total ?? 0).toBeGreaterThan(w.baseCost / (10 * MINUTE))
    }
  })
})

describe('comets', () => {
  it('reward catching them without making them mandatory', () => {
    // Average extra income for a player who catches every comet (windfalls not counted).
    const boost = expectedCometBoost()
    expect(boost.production).toBeGreaterThan(0.15)
    expect(boost.production).toBeLessThan(0.35)
    expect(boost.mining).toBeGreaterThan(0.2)
    expect(boost.mining).toBeLessThan(0.45)
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
