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
    const store = createGameStore(storage, 0)
    store.getState().actions.fire(() => 0.5)
    store.getState().actions.save({ announce: true, now: 0 })
    expect(JSON.parse(storage.data.get(SAVE_KEY) ?? '{}').clicks).toBe(1)
    expect(store.getState().notices.at(-1)?.title).toBe('Game saved')

    store.getState().actions.reset()
    expect(storage.data.has(SAVE_KEY)).toBe(false)
    expect(store.getState().game).toEqual(createInitialState())
  })
})
