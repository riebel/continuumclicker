import { describe, expect, it } from 'vitest'
import { MODULE_MIN_RING, MODULES, SECTOR_RINGS } from './content'
import { generateSector, HOME_ID } from './sector'

const seeds = Array.from({ length: 200 }, (_, i) => i * 7919 + 13)

describe('sector generation', () => {
  it('is deterministic per seed', () => {
    expect(generateSector(42)).toEqual(generateSector(42))
    expect(generateSector(42).systems).not.toEqual(generateSector(43).systems)
  })

  it('places the home station at the origin and every ring at its distance', () => {
    const { systems } = generateSector(7)
    expect(systems[0]).toMatchObject({ id: HOME_ID, x: 0, y: 0, kind: 'home' })
    for (const system of systems.slice(1)) {
      const ring = SECTOR_RINGS[system.ring]
      expect(ring).toBeDefined()
      expect(system.distance).toBeGreaterThanOrEqual(ring?.minKm ?? 0)
      expect(system.distance).toBeLessThanOrEqual(ring?.maxKm ?? 0)
      expect(Math.hypot(system.x, system.y)).toBeCloseTo(system.distance, 0)
    }
    expect(systems).toHaveLength(1 + SECTOR_RINGS.reduce((n, r) => n + r.kinds.length, 0))
  })

  it('gives every system a unique id and name', () => {
    for (const seed of seeds) {
      const { systems } = generateSector(seed)
      expect(new Set(systems.map((s) => s.id)).size).toBe(systems.length)
      expect(new Set(systems.map((s) => s.name)).size).toBe(systems.length)
    }
  })

  it('never locks a module away: each one is placed once, where it is due', () => {
    for (const seed of seeds) {
      const { systems } = generateSector(seed)
      for (const { id } of MODULES) {
        const sources = systems.filter(
          (s) => s.find === id || s.offers.some((offer) => offer.module === id),
        )
        expect(sources, `${id} in seed ${seed}`).toHaveLength(1)
        const ring = sources[0]?.ring ?? -1
        expect(ring).toBeGreaterThanOrEqual(MODULE_MIN_RING[id])
        expect(ring).toBeLessThanOrEqual(MODULE_MIN_RING[id] + 1)
      }
    }
  })

  it('prices modules by how far out they are sold', () => {
    const { systems } = generateSector(99)
    for (const system of systems) {
      for (const offer of system.offers) {
        const base = SECTOR_RINGS[system.ring]?.price ?? 0
        expect(offer.price).toBeGreaterThanOrEqual(base * 0.99)
        expect(offer.price).toBeLessThanOrEqual(base * 1.51)
      }
    }
  })
})
