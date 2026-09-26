import { describe, expect, it } from 'vitest'
import { memoryStorage } from '../test/memoryStorage'
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
    expect(store.getState().game.energy).toBeCloseTo(10)
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
      owned: { ...createInitialState().owned, 'avidyne-engine': 10 },
    }
    saveGame(storage, state, 0)

    const store = createGameStore(storage, 3_600_000)
    store.getState().actions.tick(3_600_000)
    expect(store.getState().game.energy).toBeCloseTo(3600)
    expect(store.getState().notices[0]?.title).toMatch(/away for 1 h/)
  })

  it('saves on demand and can be reset', () => {
    const storage = memoryStorage()
    const store = createGameStore(storage, 0)
    store.getState().actions.click(() => 0.5)
    store.getState().actions.save({ announce: true, now: 0 })
    expect(JSON.parse(storage.data.get(SAVE_KEY) ?? '{}').clicks).toBe(1)
    expect(store.getState().notices.at(-1)?.title).toBe('Game saved')

    store.getState().actions.reset()
    expect(storage.data.has(SAVE_KEY)).toBe(false)
    expect(store.getState().game).toEqual(createInitialState())
  })
})
