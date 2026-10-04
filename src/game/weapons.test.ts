import { describe, expect, it } from 'vitest'
import { SHIP_FORMS, UPGRADES, WEAPONS, type WeaponId } from './content'
import {
  buyWeapon,
  createInitialState,
  fire,
  type GameState,
  selectWeapon,
  shipForm,
  shipModuleTiers,
} from './engine'
import { fromSaveData, toSaveData } from './save'

const noCrit = () => 0.5
function armed(id: WeaponId, patch: Partial<GameState> = {}): GameState {
  const initial = createInitialState()
  return { ...initial, weapons: { ...initial.weapons, [id]: 1 }, activeWeapon: id, ...patch }
}

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
