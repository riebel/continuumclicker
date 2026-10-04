import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import {
  advanceBoss,
  BOSS_RULES,
  BOSS_TYPES,
  type BossEncounter,
  createBoss,
  fireAtBoss,
  retreatBoss,
} from './bosses'
import {
  COMETS,
  CRYSTAL_VEIN,
  type LaserUpgradeId,
  MODULE_EFFECTS,
  MODULES,
  type ModuleId,
  SHIP_FORMS,
  SPEED_LEVELS,
  UPGRADES,
  type UpgradeId,
  WEAPONS,
  type WeaponId,
} from './content'
import {
  type Arrival,
  type Asteroid,
  advance,
  buyLaser,
  buyModule,
  buyUpgrade,
  buyWeapon,
  type CometReward,
  catchComet,
  createAsteroid,
  createInitialState,
  createWeaponCharges,
  crystalChance,
  darkMatterBonus,
  engage,
  equip,
  fastestSustainable,
  fireSalvo,
  type GameState,
  hasModule,
  jumpSector,
  MINING_TARGET_COUNT,
  milestoneMultiplier,
  type Shot,
  selectWeapon,
  setCourse,
  shipForm,
  unequip,
  visualTier,
} from './engine'
import { formatDuration, formatNumber } from './format'
import { browserStorage, clearSave, loadGame, saveGame } from './save'
import { findSystem, newSectorSeed, sectorFor } from './sector'

const veinChance = (game: GameState) =>
  CRYSTAL_VEIN.chance *
  (hasModule(game, 'crystal-scanner') ? MODULE_EFFECTS.crystalScannerVeins : 1)

/** Gaps longer than this (tab in background, app closed) are reported as offline progress. */
export const OFFLINE_REPORT_AFTER_MS = 60_000

export type NoticeKind = 'info' | 'success' | 'warning'

export interface Notice {
  readonly id: number
  readonly kind: NoticeKind
  readonly title: string
  readonly message?: string
}

export interface Comet {
  readonly id: number
  /** Epoch ms. */
  readonly appearedAt: number
  readonly leavesAt: number
}

export interface Vein {
  readonly id: number
  /** Where on the asteroid it glows, in radians. */
  readonly angle: number
  /** Epoch ms. */
  readonly closesAt: number
}

interface PendingTarget {
  readonly asteroid: Asteroid
  readonly frozen: boolean
  readonly vein: Vein | null
}

export interface GameStore {
  readonly game: GameState
  readonly boss: BossEncounter | null
  /** Active mining time toward the next interception. Never advances offline. */
  readonly bossClock: number
  /** Epoch ms up to which the simulation has been advanced. */
  readonly lastTick: number
  readonly notices: readonly Notice[]
  /** The most recent laser shot, for effects. Not saved. */
  readonly lastShot:
    | (Shot & { readonly id: number; readonly targetId: number; readonly nextTargetId: number })
    | null
  /** Acquisition cursor, independent of the number of destroyed asteroids. Not saved. */
  readonly miningTarget: number
  readonly pendingTargets: readonly (PendingTarget | null)[]
  /** The comet crossing the screen, if any. Comets only appear while the game is open. */
  readonly comet: Comet | null
  /** Epoch ms when the next comet appears. */
  readonly nextCometAt: number
  /** A crystal vein open on the asteroid, if any. */
  readonly vein: Vein | null
  readonly actions: {
    tick(now?: number): void
    /** Fires the mining laser; `vein` strikes the open crystal vein for a guaranteed crit. */
    fire(options?: { vein?: boolean }): Shot
    /** Retires a target that has passed the bow; keeps its damage for later reacquisition. */
    passTarget(expected: number): void
    /** Chooses the next visible rock before firing, exchanging its retained target data. */
    prepareTarget(expected: number, slot: number): void
    /** Catches the current comet. Returns its reward, or null if there is none to catch. */
    catchComet(): CometReward | null
    /** Plots a course to a system, engaging the engines if the ship is standing still. */
    setCourse(system: string): void
    buyModule(id: ModuleId): void
    equip(id: ModuleId): void
    unequip(id: ModuleId): void
    /** Jumps to a fresh sector, collecting the pending dark matter. */
    jump(): void
    buy(id: UpgradeId): void
    buyLaser(id: LaserUpgradeId): void
    buyWeapon(id: WeaponId): void
    selectWeapon(id: WeaponId): void
    retreatBoss(): void
    engage(speedLevel: number): void
    save(options?: { announce?: boolean; now?: number }): void
    reset(): void
    notify(notice: Omit<Notice, 'id'>): void
    dismiss(id: number): void
  }
}

type Storage = Parameters<typeof saveGame>[0]

export function createGameStore(
  storage: Storage = browserStorage(),
  now = Date.now(),
  random: () => number = Math.random,
) {
  const loaded = loadGame(storage, now)
  let noticeId = 0
  let shotId = 0
  let eventId = 0
  let systemCharges = createWeaponCharges()
  let lastFireAt = Number.NEGATIVE_INFINITY
  let bossSequence = loaded?.state.bossesDefeated ?? 0
  let bossDue = BOSS_RULES.firstAfter as number
  const between = ([min, max]: readonly [number, number]) => (min + random() * (max - min)) * 1000

  return createStore<GameStore>()((set, get) => {
    const notify = (notice: Omit<Notice, 'id'>) => {
      const id = ++noticeId
      set((s) => ({ notices: [...s.notices.slice(-3), { ...notice, id }] }))
    }

    const lured = () => hasModule(get().game, 'comet-lure')
    /** When the next comet comes, counted from `time`. */
    const nextComet = (time: number) =>
      time + between(COMETS.interval) / (lured() ? MODULE_EFFECTS.cometLureFrequency : 1)

    /** Spawns, retires and schedules comets and veins. */
    const updateEvents = (time: number, returning: boolean) => {
      const { comet, nextCometAt, vein } = get()
      if (vein && time >= vein.closesAt) set({ vein: null })
      if (comet && time >= comet.leavesAt) {
        set({ comet: null, nextCometAt: nextComet(time) })
      } else if (returning) {
        // No comet waits for a returning player: start the countdown afresh.
        set({ comet: null, nextCometAt: time + between(COMETS.firstAfter) })
      } else if (!comet && time >= nextCometAt) {
        const id = ++eventId
        const lifetime = COMETS.lifetime * (lured() ? MODULE_EFFECTS.cometLureLifetime : 1)
        set({ comet: { id, appearedAt: time, leavesAt: time + lifetime * 1000 } })
      }
    }

    const announce = (arrival: Arrival) => {
      const { game } = get()
      const system = findSystem(sectorFor(game.sectorSeed), arrival.system)
      if (!system) return
      const found = arrival.module && MODULES.find((m) => m.id === arrival.module)
      const details = [
        arrival.energy > 0 && `+${formatNumber(arrival.energy)} energy`,
        found && `Found a ${found.name} module!`,
        arrival.overdrive && 'The anomaly overcharged the reactors.',
      ].filter(Boolean)
      notify({
        kind: arrival.firstVisit ? 'success' : 'info',
        title: `Arrived at ${system.name}`,
        ...(details.length > 0 && { message: details.join(' ') }),
      })
    }

    return {
      game: loaded?.state ?? createInitialState(newSectorSeed(random)),
      lastTick: loaded ? Math.min(loaded.savedAt, now) : now,
      notices: [],
      lastShot: null,
      miningTarget: loaded?.state.asteroidsMined ?? 0,
      pendingTargets: Array.from({ length: MINING_TARGET_COUNT }, () => null),
      comet: null,
      nextCometAt: now + between(COMETS.firstAfter),
      vein: null,
      boss: null,
      bossClock: 0,
      actions: {
        tick(time = Date.now()) {
          const { game, lastTick } = get()
          const elapsedMs = time - lastTick
          if (elapsedMs <= 0) {
            // Clock went backwards (or no time passed): just resynchronise.
            if (elapsedMs < 0) set({ lastTick: time })
            return
          }

          const result = advance(game, elapsedMs / 1000)
          set({ game: result.state, lastTick: time })
          updateEvents(time, elapsedMs >= OFFLINE_REPORT_AFTER_MS)
          const current = get()
          const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
          if (elapsedMs < OFFLINE_REPORT_AFTER_MS && !hidden) {
            if (current.boss) {
              const boss = advanceBoss(current.boss, elapsedMs / 1000)
              set({ boss })
              if (boss?.stage === 'escaped' && current.boss.stage !== 'escaped') {
                bossDue = BOSS_RULES.interval
                set({ bossClock: 0 })
                notify({
                  kind: 'info',
                  title: 'Emergency disengage',
                  message: 'Shields recovering. Cargo and upgrades are safe.',
                })
              }
            } else if (
              time - lastFireAt < 12_000 &&
              current.game.asteroidsMined >= BOSS_RULES.minimumMined &&
              shipForm(current.game) >= 1
            ) {
              const bossClock = current.bossClock + elapsedMs / 1000
              if (bossClock >= bossDue) {
                const kind = bossSequence++ % 2 === 0 ? 'leviathan' : 'dreadnought'
                const boss = createBoss(current.game, ++eventId, kind)
                set({ boss, bossClock: 0 })
                notify({
                  kind: 'warning',
                  title: 'Long-range contact',
                  message: BOSS_TYPES[kind].signal,
                })
              } else set({ bossClock })
            }
          } else if (current.boss && ['warning', 'combat'].includes(current.boss.stage)) {
            // Returning players never lose a fight or receive an unearned offline bounty.
            bossDue = BOSS_RULES.interval
            set({ boss: null, bossClock: 0 })
          }
          for (const arrival of result.arrivals) announce(arrival)

          if (elapsedMs >= OFFLINE_REPORT_AFTER_MS) {
            const earned = result.state.lifetimeEnergy - game.lifetimeEnergy
            const travelled = result.state.distance - game.distance
            notify({
              kind: 'info',
              title: `Welcome back, Captain. You were away for ${formatDuration(elapsedMs / 1000)}.`,
              message: `Reactors produced ${formatNumber(earned)} energy and the ship travelled ${formatNumber(travelled)} km.`,
            })
          }
          if (result.downshifted) {
            notify({
              kind: 'warning',
              title: 'Energy reserves depleted',
              message: `Dropped to ${SPEED_LEVELS[result.state.speedLevel]?.name ?? 'full stop'}, the fastest speed your reactors can sustain.`,
            })
          }
        },

        fire({ vein = false } = {}) {
          const time = Date.now()
          get().actions.tick(time)
          const struck = vein && get().vein !== null
          const before = get()
          lastFireAt = time
          if (before.boss?.stage === 'combat') {
            const result = fireAtBoss(before.game, before.boss, systemCharges, random)
            systemCharges = result.charges
            set({
              game: result.game,
              boss: result.boss,
              lastShot: {
                ...result.shot,
                id: ++shotId,
                targetId: -before.boss.id,
                nextTargetId: -before.boss.id,
              },
            })
            if (result.boss.stage === 'victory') {
              bossDue = BOSS_RULES.interval
              set({ bossClock: 0 })
              notify({
                kind: 'success',
                title: `${BOSS_TYPES[result.boss.kind].name} defeated`,
                message: `+${formatNumber(result.shot.bonus)} energy bounty. ${result.game.bossesDefeated} bosses defeated.`,
              })
              get().actions.save({ now: time })
            }
            return result.shot
          }
          const nextId = before.miningTarget + 1
          const pending = before.pendingTargets[nextId % MINING_TARGET_COUNT]
          const { state, charges, ...shot } = fireSalvo(before.game, systemCharges, random, {
            vein: struck,
            ...(pending && { nextAsteroid: pending.asteroid }),
          })
          systemCharges = charges
          const broken = shot.target.hp <= 0
          const pendingTargets = [...before.pendingTargets]
          if (broken) {
            pendingTargets[before.miningTarget % MINING_TARGET_COUNT] = null
            pendingTargets[nextId % MINING_TARGET_COUNT] = null
          }
          set({
            game: broken && pending ? { ...state, frozen: pending.frozen } : state,
            miningTarget: broken ? nextId : before.miningTarget,
            pendingTargets,
            lastShot: {
              ...shot,
              id: ++shotId,
              targetId: before.miningTarget,
              nextTargetId: broken ? nextId : before.miningTarget,
            },
            ...(broken && {
              vein: pending?.vein && pending.vein.closesAt > time ? pending.vein : null,
            }),
          })
          if (struck) {
            if (!broken) set({ vein: null })
          } else if (!get().vein && random() < veinChance(get().game)) {
            const id = ++eventId
            set({
              vein: {
                id,
                angle: random() * Math.PI * 2,
                closesAt: time + CRYSTAL_VEIN.lifetime * 1000,
              },
            })
          }
          return shot
        },

        passTarget(expected) {
          const before = get()
          if (before.boss?.stage === 'combat') return
          // A projectile/another frame may already have advanced acquisition.
          if (before.miningTarget !== expected) return
          const nextId = expected + 1
          const pendingTargets = [...before.pendingTargets]
          const pending = pendingTargets[nextId % MINING_TARGET_COUNT]
          pendingTargets[expected % MINING_TARGET_COUNT] = {
            asteroid: before.game.asteroid,
            frozen: before.game.frozen,
            vein: before.vein,
          }
          pendingTargets[nextId % MINING_TARGET_COUNT] = null
          set({
            miningTarget: nextId,
            pendingTargets,
            game: {
              ...before.game,
              asteroid: pending?.asteroid ?? createAsteroid(random, crystalChance(before.game)),
              frozen: before.game.activeWeapon === 'cryo' && (pending?.frozen ?? false),
            },
            vein: pending?.vein && pending.vein.closesAt > Date.now() ? pending.vein : null,
          })
        },

        prepareTarget(expected, slot) {
          const before = get()
          if (
            before.miningTarget !== expected ||
            slot === expected % MINING_TARGET_COUNT ||
            slot < 0 ||
            slot >= MINING_TARGET_COUNT
          )
            return
          const next = (expected + 1) % MINING_TARGET_COUNT
          if (next === slot) return
          const pendingTargets = [...before.pendingTargets]
          const selected = pendingTargets[slot] ?? null
          pendingTargets[slot] = pendingTargets[next] ?? null
          pendingTargets[next] = selected
          set({ pendingTargets })
        },

        catchComet() {
          get().actions.tick()
          if (!get().comet) return null
          const { state, reward } = catchComet(get().game, random)
          set({ game: state, comet: null, nextCometAt: nextComet(Date.now()) })
          return reward
        },

        setCourse(to) {
          get().actions.tick()
          const before = get().game
          let game = setCourse(before, to)
          if (game === before) return
          // Leaving from a standstill: engage the fastest speed the reactors can hold.
          if (game.speedLevel === 0) game = engage(game, fastestSustainable(game))
          set({ game })
        },

        buyModule(id) {
          get().actions.tick()
          set((s) => ({ game: buyModule(s.game, id) }))
        },

        equip(id) {
          set((s) => ({ game: equip(s.game, id) }))
        },

        unequip(id) {
          set((s) => ({ game: unequip(s.game, id) }))
        },

        jump() {
          const time = Date.now()
          get().actions.tick(time)
          const before = get().game
          const game = jumpSector(before, newSectorSeed(random))
          if (game === before) return
          systemCharges = createWeaponCharges()
          bossDue = BOSS_RULES.firstAfter
          lastFireAt = Number.NEGATIVE_INFINITY
          set({
            game,
            notices: [],
            lastShot: null,
            miningTarget: 0,
            pendingTargets: Array.from({ length: MINING_TARGET_COUNT }, () => null),
            comet: null,
            nextCometAt: time + between(COMETS.firstAfter),
            vein: null,
            boss: null,
            bossClock: 0,
          })
          notify({
            kind: 'success',
            title: `Jumped to sector ${game.jumps + 1}`,
            message: `${formatNumber(game.darkMatter)} dark matter now boosts production by ${formatNumber((darkMatterBonus(game) - 1) * 100)}%.`,
          })
          get().actions.save()
        },

        buy(id) {
          get().actions.tick()
          const beforeForm = shipForm(get().game)
          const before = get().game.owned[id]
          set((s) => ({ game: buyUpgrade(s.game, id) }))
          const after = get().game.owned[id]
          const name = UPGRADES.find((u) => u.id === id)?.name ?? id
          const tier = visualTier(after)
          const boosted = milestoneMultiplier(after) > milestoneMultiplier(before)
          const boost = boosted ? `${name} output doubled.` : undefined
          if (tier > visualTier(before)) {
            const form = shipForm(get().game)
            notify({
              kind: 'success',
              title:
                form > beforeForm
                  ? `Ship transformed: ${SHIP_FORMS[form]?.name}`
                  : `Ship upgraded: ${name} module ${tier}/5 installed`,
              ...(form > beforeForm
                ? {
                    message: [
                      SHIP_FORMS[form]?.detail,
                      `${name} module ${tier}/5 installed.`,
                      boost,
                    ]
                      .filter(Boolean)
                      .join(' '),
                  }
                : boost
                  ? { message: boost }
                  : {}),
            })
          } else if (boost) {
            notify({ kind: 'success', title: boost })
          }
        },

        buyLaser(id) {
          get().actions.tick()
          set((s) => ({ game: buyLaser(s.game, id) }))
        },

        buyWeapon(id) {
          get().actions.tick()
          const before = get().game
          const game = buyWeapon(before, id)
          if (game === before) return
          set({ game })
          notify({
            kind: 'success',
            title: `${WEAPONS.find((w) => w.id === id)?.name} ${before.weapons[id] === 0 ? 'installed' : `upgraded to L${game.weapons[id]}`}`,
          })
        },

        selectWeapon(id) {
          set((s) => ({ game: selectWeapon(s.game, id) }))
        },

        retreatBoss() {
          const boss = get().boss
          if (!boss || !['warning', 'combat'].includes(boss.stage)) return
          bossDue = BOSS_RULES.interval
          set({ boss: retreatBoss(boss), bossClock: 0 })
          notify({
            kind: 'info',
            title: 'Contact evaded',
            message: 'Mining resumed. Cargo and upgrades are safe.',
          })
        },

        engage(speedLevel) {
          get().actions.tick()
          set((s) => ({ game: engage(s.game, speedLevel) }))
        },

        save({ announce = false, now = Date.now() } = {}) {
          get().actions.tick(now)
          const ok = saveGame(storage, get().game, now)
          if (!ok) notify({ kind: 'warning', title: 'Could not save — storage is unavailable.' })
          else if (announce) notify({ kind: 'success', title: 'Game saved' })
        },

        reset() {
          systemCharges = createWeaponCharges()
          bossDue = BOSS_RULES.firstAfter
          bossSequence = 0
          lastFireAt = Number.NEGATIVE_INFINITY
          clearSave(storage)
          const time = Date.now()
          set({
            game: createInitialState(newSectorSeed(random)),
            lastTick: time,
            notices: [],
            lastShot: null,
            miningTarget: 0,
            pendingTargets: Array.from({ length: MINING_TARGET_COUNT }, () => null),
            comet: null,
            nextCometAt: time + between(COMETS.firstAfter),
            vein: null,
            boss: null,
            bossClock: 0,
          })
        },

        notify,

        dismiss(id) {
          set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }))
        },
      },
    }
  })
}

export type GameStoreApi = ReturnType<typeof createGameStore>

export const gameStore = createGameStore()

export function useGame<T>(selector: (store: GameStore) => T): T {
  return useStore(gameStore, selector)
}

export const useActions = () => useGame((s) => s.actions)
