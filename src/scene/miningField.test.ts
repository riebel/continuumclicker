import { describe, expect, it } from 'vitest'
import { createGameStore } from '../game/store'
import { memoryStorage } from '../test/memoryStorage'
import {
  beltRate,
  beltVisibility,
  type FieldRock,
  MiningField,
  TARGET_PASS_PHASE,
} from './miningField'

const rock = { kind: 'rock' as const, hp: 4, maxHp: 4 }
const crystal = { kind: 'crystal' as const, hp: 8, maxHp: 8 }

describe('automatic field acquisition', () => {
  it('acquires an already visible neighbour and refills only the consumed slot', () => {
    const field = new MiningField(12, 'rock')
    const next = field.rocks[field.slot(13)]
    const before = field.rocks.map((r) => r.ordinal)
    field.apply({ ordinal: 12, target: { ...rock, hp: 0 }, next: crystal, nextOrdinal: 13 }, 2)
    expect(field.target).toBe(next)
    expect(field.target.kind).toBe('crystal')
    expect(field.target.enteredAt).toBe(-1)
    expect(field.rocks[field.slot(12)]?.ordinal).toBe(17)
    expect(field.rocks.filter((r, i) => r.ordinal !== before[i])).toHaveLength(1)
  })

  it('holds the same target until destroyed and preserves damage on the next target', () => {
    const field = new MiningField(0, 'rock')
    field.apply({ ordinal: 0, target: { ...rock, hp: 2 }, next: rock, nextOrdinal: 0 }, 1)
    expect(field.ordinal).toBe(0)
    expect(field.target.damage).toBe(0.5)
    field.apply(
      { ordinal: 0, target: { ...rock, hp: 0 }, next: { ...rock, hp: 1 }, nextOrdinal: 1 },
      2,
    )
    expect(field.target.damage).toBe(0.75)
  })

  it('handles rapid shots spanning multiple kills without hitting the wrong visible slot', () => {
    const field = new MiningField(3, 'rock')
    for (let ordinal = 3; ordinal < 20; ordinal++) {
      field.apply(
        { ordinal, target: { ...rock, hp: 0 }, next: rock, nextOrdinal: ordinal + 1 },
        ordinal,
      )
      expect(field.ordinal).toBe(ordinal + 1)
      expect(field.rocks.map((r) => r.ordinal).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 5 }, (_, i) => ordinal + 1 + i),
      )
    }
  })

  it('resynchronizes after loading or resetting a game without replaying old explosions', () => {
    const field = new MiningField(91, 'crystal')
    field.reset(0, 'rock')
    expect(field.target.kind).toBe('rock')
    expect(field.rocks.every((r) => r.enteredAt === -1 && r.flash === 0 && r.damage === 0)).toBe(
      true,
    )
  })
})

describe('flight through the mining belt', () => {
  it('keeps the rendered targets and retained game damage synchronized through sustained flight', () => {
    const store = createGameStore(memoryStorage(), Date.now(), () => 0.99)
    const field = new MiningField(0, 'rock')
    const { actions } = store.getState()
    let passes = 0
    for (let frame = 0; frame < 3000; frame++) {
      const passing = field.advance(1 / 30, 1, false, false)
      const selected = field.prepareNext()
      if (selected !== null) actions.prepareTarget(field.ordinal, selected)
      if (frame % 90 === 0) {
        const ordinal = store.getState().miningTarget
        const shot = actions.fire()
        const after = store.getState()
        field.apply(
          { ...shot, ordinal, next: after.game.asteroid, nextOrdinal: after.miningTarget },
          frame / 30,
        )
      } else if (passing) {
        actions.passTarget(field.ordinal)
        const after = store.getState()
        field.pass(after.miningTarget, after.game.asteroid)
        passes++
      }
      const { game, pendingTargets, miningTarget } = store.getState()
      expect(field.ordinal).toBe(miningTarget)
      expect(field.target.kind).toBe(game.asteroid.kind)
      expect(field.target.damage).toBeCloseTo(1 - game.asteroid.hp / game.asteroid.maxHp)
      for (const [i, pending] of pendingTargets.entries()) {
        if (!pending) continue
        expect(field.rocks[i]?.kind).toBe(pending.asteroid.kind)
        expect(field.rocks[i]?.damage).toBeCloseTo(1 - pending.asteroid.hp / pending.asteroid.maxHp)
      }
    }
    expect(passes).toBeGreaterThan(10)
    expect(passes).toBeLessThan(60)
    expect(store.getState().game.clicks).toBe(34)
    expect(store.getState().game.asteroidsMined).toBeGreaterThan(0)
  })

  it('plans an approaching target without moving or resetting the physical rocks', () => {
    const field = new MiningField(0, 'rock')
    const before = field.rocks.map((r) => ({
      rock: r,
      lane: r.lane,
      phase: r.phase,
      model: r.model,
    }))
    ;(field.rocks[1] as FieldRock).phase = 0.85
    ;(field.rocks[2] as FieldRock).phase = 0.3
    const selected = field.rocks[2]
    expect(field.prepareNext()).toBe(2)
    expect(field.rocks[field.slot(1)]).toBe(selected)
    expect(field.prepareNext()).toBeNull()
    for (const { rock, lane, model } of before) {
      expect(rock.lane).toBe(lane)
      expect(rock.model).toBe(model)
    }
    expect(field.rocks.map((r) => r.ordinal).sort()).toEqual([0, 1, 2, 3, 4])
  })

  it('streams faster with the engaged drive, with a readable upper limit', () => {
    expect(beltRate(0)).toBe(0)
    expect(beltRate(0.1)).toBeLessThan(beltRate(0.6))
    expect(beltRate(0.6)).toBeLessThan(beltRate(1))
    expect(beltRate(100)).toBe(beltRate(1))
    expect(1 / beltRate(1)).toBeGreaterThan(13)
    const slow = new MiningField(0, 'rock')
    const fast = new MiningField(0, 'rock')
    for (let i = 0; i < 20; i++) {
      slow.advance(0.1, 0.1, false, false)
      fast.advance(0.1, 1, false, false)
    }
    expect(fast.target.phase).toBeGreaterThan(slow.target.phase)
    const before = fast.speed
    fast.advance(0.1, 0, false, false)
    expect(fast.speed).toBeLessThan(before)
    expect(fast.speed).toBeGreaterThan(0)
  })

  it('allows a pass only after queued projectiles have landed, with no damage reset', () => {
    const field = new MiningField(0, 'rock')
    field.target.damage = 0.5
    field.target.phase = TARGET_PASS_PHASE - 0.001
    expect(field.advance(0.1, 1, false, true)).toBe(false)
    expect(field.target.phase).toBeLessThanOrEqual(TARGET_PASS_PHASE)
    expect(field.advance(0.1, 1, false, false)).toBe(true)
    const departing = field.target
    const model = departing.model
    field.pass(1, crystal)
    expect(departing.damage).toBe(0.5)
    expect(departing.model).toBe(model)
    expect(field.target.kind).toBe('crystal')
    expect(field.ordinal).toBe(1)
  })

  it('keeps reduced motion stable and fades only at the distant/exit ends', () => {
    const field = new MiningField(0, 'rock')
    const phases = field.rocks.map((r) => r.phase)
    for (let i = 0; i < 100; i++) expect(field.advance(0.1, 1, true, false)).toBe(false)
    expect(field.rocks.map((r) => r.phase)).toEqual(phases)
    expect(beltVisibility(0)).toBe(0)
    expect(beltVisibility(1)).toBe(0)
    expect(beltVisibility(0.01)).toBeLessThan(beltVisibility(0.04))
    expect(beltVisibility(TARGET_PASS_PHASE)).toBe(1)
  })
})
