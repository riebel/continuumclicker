import * as z from 'zod/mini'
import {
  COMETS,
  LASER_UPGRADES,
  type LaserUpgradeDef,
  SPEED_LEVELS,
  SPEED_OF_LIGHT_KMH,
  UPGRADES,
} from './content'
import { type Buff, createInitialState, type GameState } from './engine'

export const SAVE_KEY = 'continuum-clicker:save'
export const SAVE_VERSION = 3

/** Keys written by the original 2014 jQuery version. */
export const LEGACY_KEYS = { game: 'continuumClicker.game', version: 'continuumClicker.version' }

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const amount = z.number().check(z.gte(0))
const count = z.int().check(z.gte(0))

const saveSchema = z.object({
  version: z.literal(SAVE_VERSION),
  savedAt: z.number(),
  energy: amount,
  distance: amount,
  speedLevel: z.string(),
  owned: z.record(z.string(), count),
  // Added with asteroid mining; older version 3 saves lack them.
  lasers: z.optional(z.record(z.string(), count)),
  asteroidsMined: z.optional(count),
  // Added with comets.
  buffs: z.optional(z.array(z.object({ kind: z.string(), remaining: amount }))),
  cometsCaught: z.optional(count),
  clicks: count,
  lifetimeEnergy: amount,
})

export type SaveData = z.infer<typeof saveSchema>

const legacySchema = z.object({
  totalEnergy: z.number(),
  distance: z.number(),
  speed: z.number(),
  clicks: z.optional(z.number()),
  lastUpdate: z.optional(z.string()),
  upgrades: z.array(z.object({ name: z.string(), level: z.number() })),
})

export interface LoadedGame {
  readonly state: GameState
  /** Epoch ms of the save, used to compute offline progress. */
  readonly savedAt: number
}

export function toSaveData(state: GameState, savedAt: number): SaveData {
  return {
    version: SAVE_VERSION,
    savedAt,
    energy: state.energy,
    distance: state.distance,
    speedLevel: SPEED_LEVELS[state.speedLevel]?.id ?? 'stop',
    owned: { ...state.owned },
    lasers: { ...state.lasers },
    asteroidsMined: state.asteroidsMined,
    buffs: state.buffs.map(({ kind, remaining }) => ({ kind, remaining })),
    cometsCaught: state.cometsCaught,
    clicks: state.clicks,
    lifetimeEnergy: state.lifetimeEnergy,
  }
}

/** Buffs take their strength from the current content, so rebalancing applies to them too. */
function loadBuffs(saved: SaveData['buffs']): Buff[] {
  const buffs: Buff[] = []
  for (const { kind, remaining } of saved ?? []) {
    if (kind !== 'overdrive' && kind !== 'laser-frenzy') continue
    const { multiplier, duration } = COMETS.rewards[kind]
    if (remaining > 0)
      buffs.push({ kind, multiplier, duration, remaining: Math.min(remaining, duration) })
  }
  return buffs
}

/** Only levels are persisted, so rebalanced or newly added upgrades apply to old saves. */
export function fromSaveData(data: SaveData): LoadedGame {
  const initial = createInitialState()
  const owned = { ...initial.owned }
  for (const upgrade of UPGRADES) owned[upgrade.id] = data.owned[upgrade.id] ?? 0
  const lasers = { ...initial.lasers }
  for (const upgrade of LASER_UPGRADES) {
    const { maxLevel = Number.POSITIVE_INFINITY }: LaserUpgradeDef = upgrade
    lasers[upgrade.id] = Math.min(data.lasers?.[upgrade.id] ?? 0, maxLevel)
  }

  return {
    savedAt: data.savedAt,
    state: {
      ...initial,
      energy: data.energy,
      distance: data.distance,
      speedLevel: Math.max(
        0,
        SPEED_LEVELS.findIndex((level) => level.id === data.speedLevel),
      ),
      owned,
      lasers,
      asteroidsMined: data.asteroidsMined ?? 0,
      buffs: loadBuffs(data.buffs),
      cometsCaught: data.cometsCaught ?? 0,
      clicks: data.clicks,
      lifetimeEnergy: data.lifetimeEnergy,
    },
  }
}

export function migrateLegacy(raw: unknown, now: number): LoadedGame | null {
  const parsed = legacySchema.safeParse(raw)
  if (!parsed.success) return null
  const legacy = parsed.data
  const initial = createInitialState()

  const owned = { ...initial.owned }
  for (const upgrade of UPGRADES) {
    const level = legacy.upgrades.find((u) => u.name === upgrade.name)?.level ?? 0
    owned[upgrade.id] = Math.max(0, Math.floor(level))
  }

  const c = legacy.speed / SPEED_OF_LIGHT_KMH
  const speedLevel = Math.max(
    0,
    SPEED_LEVELS.findLastIndex((level) => level.c <= c * (1 + 1e-9)),
  )
  const savedAt = legacy.lastUpdate ? Date.parse(legacy.lastUpdate) : Number.NaN

  return {
    savedAt: Number.isFinite(savedAt) ? savedAt : now,
    state: {
      ...initial,
      energy: Math.max(0, legacy.totalEnergy),
      distance: Math.max(0, legacy.distance),
      speedLevel,
      owned,
      clicks: Math.max(0, Math.floor(legacy.clicks ?? 0)),
    },
  }
}

function readJson(storage: KeyValueStorage, key: string): unknown {
  const text = storage.getItem(key)
  if (text === null) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Loads the current save, falling back to a legacy save. Never throws. */
export function loadGame(
  storage: KeyValueStorage | undefined,
  now = Date.now(),
): LoadedGame | null {
  if (!storage) return null
  try {
    const current = saveSchema.safeParse(readJson(storage, SAVE_KEY))
    if (current.success) return fromSaveData(current.data)
    return migrateLegacy(readJson(storage, LEGACY_KEYS.game), now)
  } catch {
    // Storage can throw (disabled cookies, sandboxed iframes, ...). Start fresh.
    return null
  }
}

export function saveGame(storage: KeyValueStorage | undefined, state: GameState, now = Date.now()) {
  if (!storage) return false
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(toSaveData(state, now)))
    storage.removeItem(LEGACY_KEYS.game)
    storage.removeItem(LEGACY_KEYS.version)
    return true
  } catch {
    return false
  }
}

export function clearSave(storage: KeyValueStorage | undefined) {
  if (!storage) return
  try {
    for (const key of [SAVE_KEY, LEGACY_KEYS.game, LEGACY_KEYS.version]) storage.removeItem(key)
  } catch {
    // Nothing sensible to do.
  }
}

/** `localStorage` if it is usable, otherwise undefined. */
export function browserStorage(): KeyValueStorage | undefined {
  try {
    return globalThis.localStorage ?? undefined
  } catch {
    return undefined
  }
}
