import { describe, expect, it } from 'vitest'
import { memoryStorage } from '../test/memoryStorage'
import { SPEED_LEVELS, SPEED_OF_LIGHT_KMH } from './content'
import { createInitialState } from './engine'
import { LEGACY_KEYS, loadGame, SAVE_KEY, saveGame } from './save'

describe('save games', () => {
  it('round-trips the game state', () => {
    const storage = memoryStorage()
    const state = {
      ...createInitialState(),
      energy: 123.5,
      distance: 42,
      speedLevel: 3,
      clicks: 7,
      lifetimeEnergy: 500,
      owned: { ...createInitialState().owned, 'driver-coil': 4 },
    }
    expect(saveGame(storage, state, 1000)).toBe(true)
    expect(loadGame(storage)).toEqual({ state, savedAt: 1000 })
  })

  it('returns null without a save', () => {
    expect(loadGame(memoryStorage())).toBeNull()
    expect(loadGame(undefined)).toBeNull()
  })

  it('ignores corrupt or tampered saves instead of crashing', () => {
    expect(loadGame(memoryStorage({ [SAVE_KEY]: '{nope' }))).toBeNull()
    const tampered = JSON.stringify({ version: 3, energy: -5 })
    expect(loadGame(memoryStorage({ [SAVE_KEY]: tampered }))).toBeNull()
  })

  it('survives storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {},
    }
    expect(loadGame(broken)).toBeNull()
    expect(saveGame(broken, createInitialState())).toBe(false)
  })

  it('keeps unknown upgrades out and defaults new ones to zero', () => {
    const storage = memoryStorage({
      [SAVE_KEY]: JSON.stringify({
        version: 3,
        savedAt: 1,
        energy: 1,
        distance: 1,
        speedLevel: 'warp-1',
        owned: { 'driver-coil': 2, 'removed-upgrade': 99 },
        clicks: 0,
        lifetimeEnergy: 0,
      }),
    })
    const loaded = loadGame(storage)
    expect(loaded?.state.owned['driver-coil']).toBe(2)
    expect(loaded?.state.owned['avidyne-engine']).toBe(0)
    expect(loaded?.state.owned).not.toHaveProperty('removed-upgrade')
    expect(SPEED_LEVELS[loaded?.state.speedLevel ?? -1]?.id).toBe('warp-1')
    // Saves from before asteroid mining have no laser upgrades yet.
    expect(loaded?.state.lasers['laser-amplifier']).toBe(0)
    expect(loaded?.state.asteroidsMined).toBe(0)
  })

  it('restores laser upgrades, capped at their maximum level', () => {
    const storage = memoryStorage({
      [SAVE_KEY]: JSON.stringify({
        version: 3,
        savedAt: 1,
        energy: 1,
        distance: 1,
        speedLevel: 'stop',
        owned: {},
        lasers: { 'laser-amplifier': 7, 'precision-scanner': 99 },
        asteroidsMined: 12,
        clicks: 0,
        lifetimeEnergy: 0,
      }),
    })
    const loaded = loadGame(storage)
    expect(loaded?.state.lasers).toEqual({
      'laser-amplifier': 7,
      'precision-scanner': 10,
      'crystal-resonator': 0,
    })
    expect(loaded?.state.asteroidsMined).toBe(12)
  })

  it('migrates a save from the 2014 version and removes the legacy keys on the next save', () => {
    const legacy = {
      version: 2,
      totalEnergy: 1500,
      distance: 9000,
      clicks: 321,
      speed: 0.125 * SPEED_OF_LIGHT_KMH,
      lastUpdate: '2016-03-10T12:00:00.000Z',
      upgrades: [
        { name: 'Avidyne engine', level: 12, baseCost: 15, energy: 0.1 },
        { name: 'Driver coil', level: 3, baseCost: 500, energy: 4 },
      ],
      speedLevels: [],
    }
    const storage = memoryStorage({
      [LEGACY_KEYS.game]: JSON.stringify(legacy),
      [LEGACY_KEYS.version]: '2',
    })

    const loaded = loadGame(storage)
    expect(loaded?.savedAt).toBe(Date.parse('2016-03-10T12:00:00.000Z'))
    expect(loaded?.state).toMatchObject({ energy: 1500, distance: 9000, clicks: 321 })
    expect(loaded?.state.owned['avidyne-engine']).toBe(12)
    expect(loaded?.state.owned['driver-coil']).toBe(3)
    expect(SPEED_LEVELS[loaded?.state.speedLevel ?? -1]?.id).toBe('impulse-1-2')

    saveGame(storage, loaded?.state ?? createInitialState())
    expect(storage.data.has(LEGACY_KEYS.game)).toBe(false)
    expect(storage.data.has(SAVE_KEY)).toBe(true)
  })
})
