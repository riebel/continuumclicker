import { describe, expect, it } from 'vitest'
import { SHIP_FORMS, UPGRADES, WEAPONS, type WeaponId } from './content'
import {
  buyWeapon,
  createInitialState,
  createWeaponCharges,
  expectedSalvoEnergy,
  fire,
  fireSalvo,
  type GameState,
  selectWeapon,
  shipForm,
  shipModuleTiers,
} from './engine'
import { mulberry32 } from './random'
import { fromSaveData, toSaveData } from './save'

const noCrit = () => 0.5
function armed(id: WeaponId, patch: Partial<GameState> = {}): GameState {
  const initial = createInitialState()
  return { ...initial, weapons: { ...initial.weapons, [id]: 1 }, activeWeapon: id, ...patch }
}

describe('mounted weapon volleys', () => {
  const allInstalled = (): GameState => ({
    ...createInitialState(),
    weapons: Object.fromEntries(WEAPONS.map((w) => [w.id, 1])) as GameState['weapons'],
    asteroid: { kind: 'rock' as const, hp: 100, maxHp: 100 },
  })

  it('fires every installed system at its own rhythm without selection, counting one input', () => {
    let state = allInstalled()
    let charges = createWeaponCharges()
    const fired = createWeaponCharges()
    for (let i = 0; i < 12; i++) {
      const result = fireSalvo(state, charges, noCrit)
      expect(result.salvo?.some((s) => s.weapon === 'pulse')).toBe(true)
      expect(result.state.clicks).toBe(i + 1)
      for (const shot of result.salvo ?? []) fired[shot.weapon]++
      state = result.state
      charges = result.charges
    }
    expect(fired).toEqual({
      pulse: 12,
      plasma: 4,
      railgun: 6,
      tesla: 3,
      cryo: 4,
      swarm: 3,
      singularity: 2,
    })
  })

  it('preserves plasma charge across pulse volleys and ignores locked systems', () => {
    let state = armed('pulse', {
      weapons: { ...createInitialState().weapons, plasma: 1 },
      asteroid: { kind: 'rock', hp: 100, maxHp: 100 },
    })
    let charges = createWeaponCharges()
    for (let i = 0; i < 8; i++) {
      const result = fireSalvo(state, charges, noCrit)
      expect(result.salvo?.every((s) => s.weapon === 'pulse' || s.weapon === 'plasma')).toBe(true)
      if (i === 7)
        expect(result.salvo?.find((s) => s.weapon === 'plasma')).toMatchObject({
          special: 'Plasma detonation',
          damage: 4,
        })
      state = result.state
      charges = result.charges
    }
    expect(charges.plasma).toBe(3)
  })

  it('retains frozen targets through intervening pulses until the cryo system shatters them', () => {
    let state = armed('pulse', {
      weapons: { ...createInitialState().weapons, cryo: 1 },
      clicks: 2,
      asteroid: { kind: 'rock', hp: 100, maxHp: 100 },
    })
    let charges = createWeaponCharges()
    for (let i = 2; i <= 5; i++) {
      const result = fireSalvo(state, charges, noCrit)
      expect(result.state.frozen).toBe(i < 5)
      if (i === 5)
        expect(result.salvo?.find((s) => s.weapon === 'cryo')).toMatchObject({
          special: 'Ice shatter',
          damage: 3,
          gained: 6,
        })
      state = result.state
      charges = result.charges
    }
  })

  it('clamps the whole volley to one acquired target and leaves its replacement untouched', () => {
    const next = { kind: 'crystal' as const, hp: 8, maxHp: 8 }
    const result = fireSalvo(
      { ...allInstalled(), asteroid: { kind: 'rock', hp: 1, maxHp: 4 } },
      createWeaponCharges(),
      noCrit,
      { nextAsteroid: next },
    )
    expect(result.damage).toBe(1)
    expect(result.gained).toBe(1)
    expect(result.bonus).toBe(2)
    expect(result.state.asteroidsMined).toBe(1)
    expect(result.state.asteroid).toEqual(next)
    expect(result.state.energy).toBe(3)
  })

  it('lets a charged singularity collapse lead the other mounted systems', () => {
    const charges = { ...createWeaponCharges(), singularity: 3 }
    const result = fireSalvo(
      { ...allInstalled(), clicks: 18, asteroid: { kind: 'crystal', hp: 10, maxHp: 10 } },
      charges,
      noCrit,
    )
    expect(result.salvo?.[0]).toMatchObject({
      weapon: 'singularity',
      special: 'Event horizon',
      damage: 10,
      bonus: 45,
    })
    expect(result.state.clicks).toBe(19)
    expect(result.state.energy).toBeCloseTo(23.7)
    expect(result.state.energy).toBeCloseTo(result.gained + result.bonus)
    expect(result.state.asteroidsMined).toBe(1)
  })

  it('predicts actual full-arsenal mining income without counting overkill or a lucky crystal sequence', () => {
    const initial = createInitialState()
    const start = {
      ...initial,
      owned: { ...initial.owned, 'driver-coil': 10 },
      weapons: Object.fromEntries(
        WEAPONS.map((w) => [w.id, w.id === 'pulse' ? 1 : 5]),
      ) as GameState['weapons'],
      lasers: { 'laser-amplifier': 3, 'precision-scanner': 6, 'crystal-resonator': 4 },
    }
    let game = start
    let charges = createWeaponCharges()
    const random = mulberry32(77)
    const shots = 10_000
    for (let i = 0; i < shots; i++) {
      const fired = fireSalvo(game, charges, random)
      game = fired.state
      charges = fired.charges
    }
    const measured = (game.lifetimeEnergy - start.lifetimeEnergy) / shots
    expect(expectedSalvoEnergy(start) / measured).toBeGreaterThan(0.9)
    expect(expectedSalvoEnergy(start) / measured).toBeLessThan(1.1)
  })
})

describe('weapon arsenal', () => {
  it('charges for unlocks, equips them and scales upgrade prices', () => {
    const initial = { ...createInitialState(), energy: 1_000 }
    const unlocked = buyWeapon(initial, 'plasma')
    expect(unlocked.energy).toBe(800)
    expect(unlocked.activeWeapon).toBe('plasma')
    const upgraded = buyWeapon(unlocked, 'plasma')
    expect(upgraded.energy).toBe(0)
    expect(upgraded.weapons.plasma).toBe(2)
    expect(buyWeapon(upgraded, 'plasma')).toBe(upgraded)
    expect(selectWeapon(initial, 'singularity')).toBe(initial)
    expect(initial.weapons.plasma).toBe(0)
  })

  it('caps weapon upgrades and keeps the pulse laser free', () => {
    const state = armed('railgun', {
      energy: 1e12,
      weapons: { ...createInitialState().weapons, railgun: 5 },
    })
    expect(buyWeapon(state, 'railgun')).toBe(state)
    expect(buyWeapon(state, 'pulse')).toBe(state)
  })

  it('overcharges plasma every third shot, across target changes', () => {
    let state = armed('plasma', { asteroid: { kind: 'crystal', hp: 10, maxHp: 10 } })
    for (let i = 0; i < 2; i++) {
      const result = fire(state, noCrit)
      expect(result.damage).toBe(1)
      expect(result.special).toBeNull()
      state = result.state
    }
    const charged = fire(state, noCrit)
    expect(charged.damage).toBe(4)
    expect(charged.state.asteroid.hp).toBe(4)
    expect(charged.special).toBe('Plasma detonation')
  })

  it('railgun pierces crystals for twice its regular damage', () => {
    expect(fire(armed('railgun'), noCrit).damage).toBe(2)
    const crystal = fire(
      armed('railgun', { asteroid: { kind: 'crystal', hp: 10, maxHp: 10 } }),
      noCrit,
    )
    expect(crystal.damage).toBe(4)
    expect(crystal.gained).toBe(12)
  })

  it('tesla chains into the next target and pays for its damage', () => {
    const shot = fire(armed('tesla', { asteroid: { kind: 'rock', hp: 1, maxHp: 4 } }), noCrit)
    expect(shot.chained).toBe(2)
    expect(shot.state.asteroid.hp).toBe(3)
    expect(shot.bonus).toBe(4)
    expect(shot.special).toBe('Chain lightning')
    expect(shot.state.asteroidsMined).toBe(1)
  })

  it('tesla and the chain module always leave a valid next target', () => {
    const shot = fire(
      armed('tesla', {
        asteroid: { kind: 'rock', hp: 1, maxHp: 4 },
        equipped: ['chain-laser'],
        weapons: { ...createInitialState().weapons, tesla: 5 },
      }),
      noCrit,
    )
    expect(shot.state.asteroid.hp).toBe(1)
  })

  it('cryo freezes then shatters, without freezing the replacement rock', () => {
    const frozen = fire(armed('cryo'), noCrit)
    expect(frozen.state.frozen).toBe(true)
    expect(frozen.special).toBe('Target frozen')
    const shatter = fire(frozen.state, noCrit)
    expect(shatter.damage).toBe(3)
    expect(shatter.gained).toBe(6)
    expect(shatter.state.frozen).toBe(false)
    expect(shatter.state.asteroidsMined).toBe(1)
  })

  it('swarm fires multiple hits with an increased critical chance', () => {
    const shot = fire(armed('swarm'), () => 0.14)
    expect(shot.damage).toBe(3)
    expect(shot.critical).toBe(true)
    expect(shot.gained).toBe(9)
  })

  it('singularity collapses a full crystal and multiplies its break reward', () => {
    const shot = fire(
      armed('singularity', { weaponCharge: 3, asteroid: { kind: 'crystal', hp: 10, maxHp: 10 } }),
      noCrit,
    )
    expect(shot.damage).toBe(10)
    expect(shot.gained).toBe(30)
    expect(shot.bonus).toBe(45)
    expect(shot.special).toBe('Event horizon')
    expect(shot.state.energy).toBe(75)
    expect(shot.state.lifetimeEnergy).toBe(75)
  })

  it.each(WEAPONS.map((w) => w.id))('%s cannot earn energy for overkill damage', (id) => {
    const shot = fire(armed(id, { asteroid: { kind: 'rock', hp: 1, maxHp: 4 } }), noCrit)
    expect(shot.damage).toBe(1)
    expect(shot.gained).toBe(1)
    expect(shot.state.asteroid.hp).toBeGreaterThan(0)
  })

  it('switching clears charge and ice, and selecting the current weapon preserves them', () => {
    const charged = armed('plasma', { weaponCharge: 2, frozen: true })
    expect(selectWeapon(charged, 'plasma')).toBe(charged)
    expect(selectWeapon(charged, 'pulse')).toMatchObject({ weaponCharge: 0, frozen: false })
  })

  it('restores unlocked weapons and selection while clearing temporary target effects', () => {
    const saved = toSaveData(armed('cryo', { weaponCharge: 2, frozen: true }), 10)
    expect(fromSaveData(saved).state).toMatchObject({
      activeWeapon: 'cryo',
      weapons: { cryo: 1 },
      weaponCharge: 0,
      frozen: false,
    })
    expect(
      fromSaveData({ ...saved, weapons: undefined, activeWeapon: 'cryo' }).state.activeWeapon,
    ).toBe('pulse')
    expect(
      fromSaveData({ ...saved, weapons: { cryo: 99, removed: 10 }, activeWeapon: 'removed' }).state,
    ).toMatchObject({ activeWeapon: 'pulse', weapons: { cryo: 5, pulse: 1 } })
  })
})

describe('ship evolution', () => {
  it('transforms at each combined module threshold', () => {
    for (const [index, form] of SHIP_FORMS.entries()) {
      const state = createInitialState()
      const owned = { ...state.owned }
      let remaining = form.tiers
      for (const u of UPGRADES) {
        const tier = Math.min(5, remaining)
        owned[u.id] = [0, 1, 5, 10, 25, 50][tier] ?? 0
        remaining -= tier
      }
      const refitted = { ...state, owned }
      expect(shipModuleTiers(refitted)).toBe(form.tiers)
      expect(shipForm(refitted)).toBe(index)
    }
  })
})
