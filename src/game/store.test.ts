import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryStorage } from '../test/memoryStorage'
import { COMETS, CRYSTAL_VEIN } from './content'
import { createInitialState } from './engine'
import { SAVE_KEY, saveGame } from './save'
import { createGameStore } from './store'

describe('game store', () => {
  it('advances by wall-clock time', () => {
    const store = createGameStore(memoryStorage(), 0)
    const { actions } = store.getState()
    store.setState((s) => ({
      game: { ...s.game, owned: { ...s.game.owned, 'driver-coil': 1 } },
    }))
    actions.tick(2_500)
    expect(store.getState().game.energy).toBeCloseTo(7.5) // 3 eps
    expect(store.getState().lastTick).toBe(2_500)
  })

  it('ignores clocks that jump backwards', () => {
    const store = createGameStore(memoryStorage(), 10_000)
    store.getState().actions.tick(5_000)
    expect(store.getState().lastTick).toBe(5_000)
    expect(store.getState().game.energy).toBe(0)
  })

  it('applies and reports offline progress when resuming a save', () => {
    const storage = memoryStorage()
    const state = {
      ...createInitialState(),
      owned: { ...createInitialState().owned, 'avidyne-engine': 5 }, // 0.5 eps
    }
    saveGame(storage, state, 0)

    const store = createGameStore(storage, 3_600_000)
    store.getState().actions.tick(3_600_000)
    expect(store.getState().game.energy).toBeCloseTo(1800)
    expect(store.getState().notices[0]?.title).toMatch(/away for 1 h/)
  })

  it('announces newly installed ship modules', () => {
    const store = createGameStore(memoryStorage(), 0)
    store.setState((s) => ({ game: { ...s.game, energy: 1000 } }))
    store.getState().actions.buy('avidyne-engine')
    expect(store.getState().notices.at(-1)?.title).toBe(
      'Ship upgraded: Avidyne engine module 1/5 installed',
    )
    const count = store.getState().notices.length
    store.getState().actions.buy('avidyne-engine')
    expect(store.getState().notices).toHaveLength(count)
  })

  it('announces doubled output at production milestones', () => {
    const store = createGameStore(memoryStorage(), 0)
    store.setState((s) => ({
      game: { ...s.game, energy: 1e6, owned: { ...s.game.owned, 'avidyne-engine': 9 } },
    }))
    store.getState().actions.buy('avidyne-engine')
    expect(store.getState().notices.at(-1)).toMatchObject({
      title: 'Ship upgraded: Avidyne engine module 3/5 installed',
      message: 'Avidyne engine output doubled.',
    })
  })

  it('saves on demand and can be reset', () => {
    const storage = memoryStorage()
    const store = createGameStore(storage, 0, () => 0.5)
    store.getState().actions.fire()
    store.getState().actions.save({ announce: true, now: 0 })
    expect(JSON.parse(storage.data.get(SAVE_KEY) ?? '{}').clicks).toBe(1)
    expect(store.getState().notices.at(-1)?.title).toBe('Game saved')

    store.getState().actions.reset()
    expect(storage.data.has(SAVE_KEY)).toBe(false)
    // A fresh start also gets a fresh sector.
    const { game } = store.getState()
    expect(game).toEqual(createInitialState(game.sectorSeed))
  })
})

describe('comets and crystal veins', () => {
  beforeEach(() => vi.useFakeTimers({ now: 0 }))
  afterEach(() => vi.useRealTimers())

  // random() = 0 schedules the first comet as early as possible and picks the first reward.
  const earliest = COMETS.firstAfter[0] * 1000

  it('sends a comet now and then, which leaves again if nobody catches it', () => {
    const store = createGameStore(memoryStorage(), 0, () => 0)
    const { tick } = store.getState().actions
    tick(earliest - 1)
    expect(store.getState().comet).toBeNull()
    tick(earliest)
    expect(store.getState().comet).toMatchObject({ appearedAt: earliest })

    const leaves = earliest + COMETS.lifetime * 1000
    tick(leaves)
    expect(store.getState().comet).toBeNull()
    expect(store.getState().nextCometAt).toBe(leaves + COMETS.interval[0] * 1000)
  })

  it('rewards catching a comet', () => {
    const store = createGameStore(memoryStorage(), 0, () => 0)
    vi.setSystemTime(earliest)
    store.getState().actions.tick(earliest)
    expect(store.getState().actions.catchComet()).toEqual({
      kind: 'overdrive',
      multiplier: COMETS.rewards.overdrive.multiplier,
      duration: COMETS.rewards.overdrive.duration,
    })
    expect(store.getState().comet).toBeNull()
    expect(store.getState().game.cometsCaught).toBe(1)
    expect(store.getState().actions.catchComet()).toBeNull()
  })

  it('does not keep a comet waiting for a returning player', () => {
    const store = createGameStore(memoryStorage(), 0, () => 0)
    store.getState().actions.tick(3_600_000)
    expect(store.getState().comet).toBeNull()
    expect(store.getState().nextCometAt).toBe(3_600_000 + earliest)
  })

  it('opens crystal veins that guarantee a critical hit', () => {
    let roll = 0.99
    const store = createGameStore(memoryStorage(), 0, () => roll)
    const { fire } = store.getState().actions
    expect(fire().critical).toBe(false)
    expect(store.getState().vein).toBeNull()

    roll = 0.01 // Below the vein chance.
    fire()
    expect(store.getState().vein).not.toBeNull()
    roll = 0.99
    expect(fire({ vein: true }).critical).toBe(true)
    expect(store.getState().vein).toBeNull()
    // Without an open vein, aiming for one is just a regular shot.
    expect(fire({ vein: true }).critical).toBe(false)
  })

  it('closes veins after a while', () => {
    const store = createGameStore(memoryStorage(), 0, () => 0.01)
    store.getState().actions.fire()
    expect(store.getState().vein).not.toBeNull()
    store.getState().actions.tick(CRYSTAL_VEIN.lifetime * 1000)
    expect(store.getState().vein).toBeNull()
  })
})
