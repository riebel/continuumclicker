import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryStorage } from '../test/memoryStorage'
import { COMETS, CRYSTAL_VEIN, DARK_MATTER } from './content'
import { createInitialState } from './engine'
import { SAVE_KEY, saveGame } from './save'
import { sectorFor } from './sector'
import { createGameStore } from './store'

describe('mounted system charges', () => {
  beforeEach(() => vi.useFakeTimers({ now: 0 }))
  afterEach(() => vi.useRealTimers())

  const chargedStore = () => {
    const store = createGameStore(memoryStorage(), 0, () => 0.99)
    store.setState((s) => ({
      game: {
        ...s.game,
        weapons: { ...s.game.weapons, plasma: 1 },
        asteroid: { kind: 'rock', hp: 100, maxHp: 100 },
      },
    }))
    for (let i = 0; i < 5; i++) store.getState().actions.fire()
    return store
  }

  it('keeps independently accumulated weapon charge when plotting a course', () => {
    const store = chargedStore()
    const destination = sectorFor(store.getState().game.sectorSeed).systems.find(
      (s) => s.id !== 'home',
    )
    expect(destination).toBeDefined()
    store.getState().actions.setCourse(destination?.id ?? '')
    store.getState().actions.fire()
    store.getState().actions.fire()
    expect(
      store
        .getState()
        .actions.fire()
        .salvo?.find((s) => s.weapon === 'plasma')?.special,
    ).toBe('Plasma detonation')
  })

  it('clears a previous sector’s charge before a newly installed system fires', () => {
    const store = chargedStore()
    store.setState((s) => ({ game: { ...s.game, lifetimeEnergy: DARK_MATTER.base } }))
    store.getState().actions.jump()
    store.setState((s) => ({
      game: { ...s.game, energy: 1000, asteroid: { kind: 'rock', hp: 100, maxHp: 100 } },
    }))
    store.getState().actions.buyWeapon('plasma')
    store.getState().actions.fire()
    store.getState().actions.fire()
    const shot = store.getState().actions.fire()
    expect(shot.salvo?.find((s) => s.weapon === 'plasma')).toMatchObject({
      damage: 1,
      special: null,
    })
  })
})

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
    expect(store.getState().notices.at(-1)?.title).toBe('Ship transformed: Interceptor')
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

describe('sector jumps', () => {
  it('start a new sector, announce the dark matter and save right away', () => {
    const storage = memoryStorage()
    let roll = 0
    const store = createGameStore(storage, Date.now(), () => (roll = (roll + 0.37) % 1))
    const seed = store.getState().game.sectorSeed
    store.setState((s) => ({ game: { ...s.game, lifetimeEnergy: DARK_MATTER.base * 8 } }))

    store.getState().actions.jump()

    const { game, notices } = store.getState()
    expect(game).toMatchObject({ darkMatter: 2, jumps: 1, energy: 0 })
    expect(game.sectorSeed).not.toBe(seed)
    expect(notices.at(-1)?.title).toBe('Jumped to sector 2')
    expect(JSON.parse(storage.data.get(SAVE_KEY) ?? '{}').darkMatter).toBe(2)
  })
})

describe('mining target handoff', () => {
  beforeEach(() => vi.useFakeTimers({ now: 0 }))
  afterEach(() => vi.useRealTimers())

  it('retains individual target damage and crystal locks across automatic passes', () => {
    const store = createGameStore(memoryStorage(), 0, () => 0.99)
    store.setState((s) => ({
      game: { ...s.game, asteroid: { kind: 'crystal', hp: 7, maxHp: 8 } },
      vein: { id: 7, angle: 0, closesAt: 10_000 },
    }))
    const initial = store.getState().game
    const { passTarget } = store.getState().actions
    for (let i = 0; i < 5; i++) passTarget(i)
    const after = store.getState()
    expect(after.game.asteroid).toEqual(initial.asteroid)
    expect(after.vein?.id).toBe(7)
    expect(after.game.energy).toBe(initial.energy)
    expect(after.game.clicks).toBe(0)
    expect(after.game.asteroidsMined).toBe(0)
    expect(after.pendingTargets).toHaveLength(5)
    expect(after.pendingTargets.filter(Boolean)).toHaveLength(4)
    passTarget(0) // An outdated frame cannot advance acquisition again.
    expect(store.getState().miningTarget).toBe(5)
  })

  it('destroys the acquired target, keeps the next damaged target, and bounds the cache', () => {
    const store = createGameStore(memoryStorage(), 0, () => 0.99)
    const { passTarget, fire } = store.getState().actions
    fire()
    const damaged = store.getState().game.asteroid
    passTarget(0)
    for (let i = 0; i < 30 && store.getState().miningTarget < 5; i++) fire()
    expect(store.getState().game.asteroid).toEqual(damaged)
    expect(store.getState().lastShot).toMatchObject({ targetId: 4, nextTargetId: 5 })
    for (let i = 0; i < 250; i++) passTarget(store.getState().miningTarget)
    expect(store.getState().pendingTargets.filter(Boolean)).toHaveLength(4)
    expect(store.getState().game.asteroidsMined).toBe(4)
  })

  it('clears parked targets and acquisition on reset', () => {
    const store = createGameStore(memoryStorage(), 0, () => 0.99)
    store.getState().actions.fire()
    store.getState().actions.passTarget(0)
    store.getState().actions.reset()
    expect(store.getState().miningTarget).toBe(0)
    expect(store.getState().pendingTargets.every((target) => target === null)).toBe(true)
    expect(store.getState().lastShot).toBeNull()
  })

  it('keeps damage on the visible next rock when acquisition order changes', () => {
    const store = createGameStore(memoryStorage(), 0, () => 0.99)
    const { fire, passTarget, prepareTarget } = store.getState().actions
    fire() // Slot zero: 3/4 HP.
    passTarget(0)
    fire() // Slot one: 5/6 HP.
    const parked = store.getState().game.asteroid
    passTarget(1)
    // Slot two is active. Choose the already damaged rock in slot one next.
    prepareTarget(2, 1)
    expect(store.getState().pendingTargets[3]?.asteroid).toEqual(parked)
    for (let i = 0; i < 6; i++) fire()
    expect(store.getState().game.asteroid).toEqual(parked)
    expect(store.getState().miningTarget).toBe(3)
    expect(store.getState().pendingTargets[0]?.asteroid.hp).toBe(3)
  })

  it('applies Tesla chain damage to the retained next asteroid, including its crystal value', () => {
    const store = createGameStore(memoryStorage(), 0, () => 0.99)
    const { passTarget, prepareTarget, fire } = store.getState().actions
    store.setState((s) => ({
      game: { ...s.game, asteroid: { kind: 'crystal', hp: 3, maxHp: 10 } },
    }))
    passTarget(0)
    prepareTarget(1, 0)
    store.setState((s) => ({
      game: {
        ...s.game,
        asteroid: { kind: 'rock', hp: 1, maxHp: 4 },
        activeWeapon: 'tesla',
        weapons: { ...s.game.weapons, tesla: 1 },
      },
    }))
    const shot = fire()
    expect(shot.chained).toBe(2)
    expect(store.getState().game.asteroid).toEqual({ kind: 'crystal', hp: 1, maxHp: 10 })
    expect(shot.bonus).toBe(8) // 4 × 0.5 break bonus + 2 crystal hits × 3.
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
