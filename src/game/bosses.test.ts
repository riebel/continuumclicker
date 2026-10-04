import { afterEach, describe, expect, it, vi } from 'vitest'
import { memoryStorage } from '../test/memoryStorage'
import {
  advanceBoss,
  BOSS_RULES,
  BOSS_TYPES,
  type BossId,
  bossExposed,
  bossPhase,
  createBoss,
  fireAtBoss,
  retreatBoss,
} from './bosses'
import { UPGRADES, WEAPONS } from './content'
import { createInitialState, createWeaponCharges, type GameState } from './engine'
import { mulberry32 } from './random'
import { fromSaveData, toSaveData } from './save'
import { createGameStore } from './store'

const starter = (): GameState => {
  const game = createInitialState()
  return { ...game, owned: { ...game.owned, 'avidyne-engine': 1 }, asteroidsMined: 20 }
}

function equipped(rank: number): GameState {
  const game = createInitialState()
  const counts: Record<number, number[]> = {
    1: [1],
    2: [1, 1, 1, 1],
    3: [10, 10, 10],
    4: [50, 50, 50, 1],
    5: [50, 50, 50, 50, 50, 1],
    6: [50, 50, 50, 50, 50, 50, 50, 50],
  }
  const weapons = { ...game.weapons }
  if (rank === 2) {
    weapons.plasma = 1
    weapons.railgun = 1
  }
  if (rank >= 3) for (const w of WEAPONS) if (w.id !== 'pulse') weapons[w.id] = rank - 1
  return {
    ...game,
    weapons,
    owned: Object.fromEntries(
      UPGRADES.map((u, i) => [u.id, counts[rank]?.[i] ?? 0]),
    ) as GameState['owned'],
    lasers: { ...game.lasers, 'laser-amplifier': rank - 1, 'precision-scanner': (rank - 1) * 2 },
  }
}

function fight(start: GameState, kind: BossId) {
  let game = start
  let current = { ...createBoss(game, 1, kind), stage: 'combat' as const } as ReturnType<
    typeof createBoss
  >
  let charges = createWeaponCharges()
  const random = mulberry32(1701)
  let time = 0
  while (current.stage === 'combat' && time < 110) {
    const fired = fireAtBoss(game, current, charges, random)
    game = fired.game
    current = fired.boss
    charges = fired.charges
    time += 0.25
    current = advanceBoss(current, 0.25) ?? current
  }
  return { game, boss: current, time }
}

describe('boss combat', () => {
  it.each(Object.keys(BOSS_TYPES) as BossId[])(
    '%s has three phases, with warning before live weapons',
    (kind) => {
      const boss = createBoss(starter(), 1, kind)
      expect(advanceBoss(boss, 8)?.stage).toBe('warning')
      expect(advanceBoss(boss, 9)?.stage).toBe('combat')
      expect(bossPhase(boss)).toBe(1)
      expect(bossPhase({ ...boss, hp: boss.maxHp * 0.6 })).toBe(2)
      expect(bossPhase({ ...boss, hp: boss.maxHp * 0.3 })).toBe(3)
    },
  )
  it('advances attacks exactly across long and small foreground steps', () => {
    const boss = { ...createBoss(starter(), 1, 'leviathan'), stage: 'combat' as const, chilled: 3 }
    const long = advanceBoss(boss, 20)
    let stepped = boss as typeof long
    for (let i = 0; i < 200; i++) if (stepped) stepped = advanceBoss(stepped, 0.1)
    expect(stepped?.shield).toBe(long?.shield)
    expect(stepped?.attacks).toBe(long?.attacks)
    expect(stepped?.attackIn).toBeCloseTo(long?.attackIn ?? 0)
    expect(stepped?.combatAge).toBeCloseTo(20)
  })
  it('opens a weak-point window before an attack and lets Tesla interrupt it', () => {
    const game = { ...starter(), weapons: { ...starter().weapons, tesla: 5 } }
    const boss = {
      ...createBoss(game, 1, 'dreadnought'),
      stage: 'combat' as const,
      attackIn: 2,
      stagger: 12,
    }
    expect(bossExposed(boss)).toBe(true)
    const result = fireAtBoss(game, boss, createWeaponCharges(), () => 0.99)
    expect(result.boss.interrupted).toBe(1)
    expect(result.shot.special).toBe('Attack interrupted')
    expect(result.boss.attackIn).toBeGreaterThan(2.3)
  })
  it('Cryo slows attack charge without making a boss an instant shatter kill', () => {
    const game = { ...starter(), clicks: 2, weapons: { ...starter().weapons, cryo: 5 } }
    const boss = { ...createBoss(game, 1, 'leviathan'), stage: 'combat' as const }
    const result = fireAtBoss(game, boss, createWeaponCharges(), () => 0.99)
    expect(result.boss.chilled).toBe(3.5)
    expect(advanceBoss(result.boss, 1)?.attackIn).toBeCloseTo(boss.attackIn - 0.55)
    expect(result.boss.hp).toBeGreaterThan(0)
  })
  it('resists singularity instant kills, pays once, and preserves the asteroid cache', () => {
    const game = { ...starter(), weapons: { ...starter().weapons, singularity: 5 } }
    const boss = { ...createBoss(game, 1, 'leviathan'), stage: 'combat' as const }
    const charges = { ...createWeaponCharges(), singularity: 3 }
    expect(fireAtBoss(game, boss, charges, () => 0.99).shot.damage).toBeLessThan(boss.maxHp * 0.15)
    const kill = fireAtBoss(game, { ...boss, hp: 0.1 }, charges, () => 0.99)
    expect(kill.boss.stage).toBe('victory')
    expect(kill.game.energy).toBe(game.energy + boss.reward)
    expect(kill.game.bossesDefeated).toBe(1)
    expect(kill.game.asteroid).toBe(game.asteroid)
    expect(kill.game.asteroidsMined).toBe(game.asteroidsMined)
    const repeat = fireAtBoss(kill.game, kill.boss, kill.charges)
    expect(repeat.game).toBe(kill.game)
    expect(repeat.shot.bonus).toBe(0)
  })
  it.each(Object.keys(BOSS_TYPES) as BossId[])(
    '%s is beatable in 20–85 seconds at all six progression bands',
    (kind) => {
      for (let rank = 1; rank <= 6; rank++) {
        const result = fight(equipped(rank), kind)
        expect(result.boss.rank, `rank ${rank}`).toBe(rank)
        expect(result.boss.stage, `rank ${rank}, ${result.time}s`).toBe('victory')
        expect(result.time, `rank ${rank}`).toBeGreaterThan(20)
        expect(result.time, `rank ${rank}`).toBeLessThan(85)
      }
    },
  )
  it('retreats safely when shields fail or the captain leaves', () => {
    const game = { ...starter(), energy: 1000 }
    const boss = { ...createBoss(game, 1, 'leviathan'), stage: 'combat' as const }
    expect(advanceBoss(boss, 70)?.stage).toBe('escaped')
    expect(retreatBoss(boss).stage).toBe('escaped')
    expect(advanceBoss(retreatBoss(boss), 5)).toBeNull()
    expect(game.energy).toBe(1000)
  })
  it('persists victories in old-compatible saves', () => {
    const data = toSaveData({ ...starter(), bossesDefeated: 4 }, 0)
    expect(fromSaveData(data).state.bossesDefeated).toBe(4)
    const { bossesDefeated: _, ...old } = data
    expect(fromSaveData(old).state.bossesDefeated).toBe(0)
  })
})

describe('encounter scheduling', () => {
  afterEach(() => vi.useRealTimers())
  it('intercepts only an actively mining upgraded ship, then resumes the retained rock', () => {
    vi.useFakeTimers({ now: 0 })
    const store = createGameStore(memoryStorage(), 0, () => 0.99)
    store.setState({ game: starter() })
    for (let i = 0; i < BOSS_RULES.firstAfter; i++) {
      store.getState().actions.fire()
      vi.advanceTimersByTime(1000)
      store.getState().actions.tick()
    }
    expect(store.getState().boss?.stage).toBe('warning')
    vi.advanceTimersByTime(9000)
    store.getState().actions.tick()
    expect(store.getState().boss?.stage).toBe('combat')
    const before = store.getState()
    store.getState().actions.fire()
    expect(store.getState().lastShot?.targetId).toBeLessThan(0)
    expect(store.getState().game.asteroid).toBe(before.game.asteroid)
    expect(store.getState().miningTarget).toBe(before.miningTarget)
    store.getState().actions.retreatBoss()
    const energy = store.getState().game.energy
    store.getState().actions.fire()
    expect(store.getState().game.energy).toBeGreaterThan(energy)
    expect(store.getState().lastShot?.targetId).toBeGreaterThanOrEqual(0)
  })
  it('never schedules battles offline and does not lose shields on return', () => {
    vi.useFakeTimers({ now: 0 })
    const store = createGameStore(memoryStorage(), 0, () => 0.99)
    store.setState({ game: starter() })
    vi.advanceTimersByTime(3_600_000)
    store.getState().actions.tick()
    expect(store.getState().boss).toBeNull()
    expect(store.getState().bossClock).toBe(0)
    store.setState({ boss: { ...createBoss(starter(), 1, 'leviathan'), stage: 'combat' } })
    vi.advanceTimersByTime(60_000)
    store.getState().actions.tick()
    expect(store.getState().boss).toBeNull()
    expect(store.getState().game.bossesDefeated).toBe(0)
  })
})
