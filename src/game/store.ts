import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import {
  COMETS,
  CRYSTAL_VEIN,
  type LaserUpgradeId,
  SPEED_LEVELS,
  UPGRADES,
  type UpgradeId,
} from './content'
import {
  advance,
  buyLaser,
  buyUpgrade,
  type CometReward,
  catchComet,
  createInitialState,
  engage,
  fire,
  type GameState,
  milestoneMultiplier,
  type Shot,
  visualTier,
} from './engine'
import { formatDuration, formatNumber } from './format'
import { browserStorage, clearSave, loadGame, saveGame } from './save'

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

export interface GameStore {
  readonly game: GameState
  /** Epoch ms up to which the simulation has been advanced. */
  readonly lastTick: number
  readonly notices: readonly Notice[]
  /** The most recent laser shot, for effects. Not saved. */
  readonly lastShot: (Shot & { readonly id: number }) | null
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
    /** Catches the current comet. Returns its reward, or null if there is none to catch. */
    catchComet(): CometReward | null
    buy(id: UpgradeId): void
    buyLaser(id: LaserUpgradeId): void
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
  const between = ([min, max]: readonly [number, number]) => (min + random() * (max - min)) * 1000

  return createStore<GameStore>()((set, get) => {
    const notify = (notice: Omit<Notice, 'id'>) => {
      const id = ++noticeId
      set((s) => ({ notices: [...s.notices.slice(-3), { ...notice, id }] }))
    }

    /** Spawns, retires and schedules comets and veins. */
    const updateEvents = (time: number, returning: boolean) => {
      const { comet, nextCometAt, vein } = get()
      if (vein && time >= vein.closesAt) set({ vein: null })
      if (comet && time >= comet.leavesAt) {
        set({ comet: null, nextCometAt: time + between(COMETS.interval) })
      } else if (returning) {
        // No comet waits for a returning player: start the countdown afresh.
        set({ comet: null, nextCometAt: time + between(COMETS.firstAfter) })
      } else if (!comet && time >= nextCometAt) {
        const id = ++eventId
        set({ comet: { id, appearedAt: time, leavesAt: time + COMETS.lifetime * 1000 } })
      }
    }

    return {
      game: loaded?.state ?? createInitialState(),
      lastTick: loaded ? Math.min(loaded.savedAt, now) : now,
      notices: [],
      lastShot: null,
      comet: null,
      nextCometAt: now + between(COMETS.firstAfter),
      vein: null,
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
          const { state, ...shot } = fire(get().game, random, { vein: struck })
          set({ game: state, lastShot: { ...shot, id: ++shotId } })
          if (struck) {
            set({ vein: null })
          } else if (!get().vein && random() < CRYSTAL_VEIN.chance) {
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

        catchComet() {
          get().actions.tick()
          if (!get().comet) return null
          const { state, reward } = catchComet(get().game, random)
          set({
            game: state,
            comet: null,
            nextCometAt: Date.now() + between(COMETS.interval),
          })
          return reward
        },

        buy(id) {
          get().actions.tick()
          const before = get().game.owned[id]
          set((s) => ({ game: buyUpgrade(s.game, id) }))
          const after = get().game.owned[id]
          const name = UPGRADES.find((u) => u.id === id)?.name ?? id
          const tier = visualTier(after)
          const boosted = milestoneMultiplier(after) > milestoneMultiplier(before)
          const boost = boosted ? `${name} output doubled.` : undefined
          if (tier > visualTier(before)) {
            notify({
              kind: 'success',
              title: `Ship upgraded: ${name} module ${tier}/5 installed`,
              ...(boost && { message: boost }),
            })
          } else if (boost) {
            notify({ kind: 'success', title: boost })
          }
        },

        buyLaser(id) {
          get().actions.tick()
          set((s) => ({ game: buyLaser(s.game, id) }))
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
          clearSave(storage)
          const time = Date.now()
          set({
            game: createInitialState(),
            lastTick: time,
            notices: [],
            lastShot: null,
            comet: null,
            nextCometAt: time + between(COMETS.firstAfter),
            vein: null,
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
