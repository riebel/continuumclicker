import { describe, expect, it } from 'vitest'
import { MiningField } from './miningField'

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
