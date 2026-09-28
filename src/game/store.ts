import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { type LaserUpgradeId, SPEED_LEVELS, UPGRADES, type UpgradeId } from './content'
import {
  advance,
  buyLaser,
  buyUpgrade,
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

export interface GameStore {
  readonly game: GameState
  /** Epoch ms up to which the simulation has been advanced. */
  readonly lastTick: number
  readonly notices: readonly Notice[]
  /** The most recent laser shot, for effects. Not saved. */
  readonly lastShot: (Shot & { readonly id: number }) | null
  readonly actions: {
    tick(now?: number): void
    fire(random?: () => number): Shot
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

export function createGameStore(storage: Storage = browserStorage(), now = Date.now()) {
  const loaded = loadGame(storage, now)
  let noticeId = 0
  let shotId = 0

  return createStore<GameStore>()((set, get) => {
    const notify = (notice: Omit<Notice, 'id'>) => {
      const id = ++noticeId
      set((s) => ({ notices: [...s.notices.slice(-3), { ...notice, id }] }))
    }

    return {
      game: loaded?.state ?? createInitialState(),
      lastTick: loaded ? Math.min(loaded.savedAt, now) : now,
      notices: [],
      lastShot: null,
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

        fire(random) {
          get().actions.tick()
          const { state, ...shot } = fire(get().game, random)
          set({ game: state, lastShot: { ...shot, id: ++shotId } })
          return shot
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
          set({ game: createInitialState(), lastTick: Date.now(), notices: [], lastShot: null })
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
