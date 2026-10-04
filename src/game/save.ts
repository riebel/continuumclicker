import * as z from 'zod/mini'
import {
  COMETS,
  LASER_UPGRADES,
  type LaserUpgradeDef,
  MODULE_SLOTS,
  MODULES,
  type ModuleId,
  SPEED_LEVELS,
  SPEED_OF_LIGHT_KMH,
  UPGRADES,
  WEAPON_MAX_LEVEL,
  WEAPONS,
} from './content'
import { type Buff, createInitialState, type GameState } from './engine'
import { findSystem, HOME_ID, newSectorSeed, sectorFor } from './sector'

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
  weapons: z.optional(z.record(z.string(), count)),
  activeWeapon: z.optional(z.string()),
  asteroidsMined: z.optional(count),
  // Added with comets.
  buffs: z.optional(z.array(z.object({ kind: z.string(), remaining: amount }))),
  cometsCaught: z.optional(count),
  // Added with the sector map.
  sectorSeed: z.optional(count),
  location: z.optional(z.nullable(z.string())),
  course: z.optional(
    z.nullable(
      z.object({
        fromX: z.number(),
        fromY: z.number(),
        to: z.string(),
        length: amount,
        travelled: amount,
      }),
    ),
  ),
  visited: z.optional(z.array(z.string())),
  modules: z.optional(z.array(z.string())),
  equipped: z.optional(z.array(z.string())),
  // Added with sector jumps.
  darkMatter: z.optional(count),
  jumps: z.optional(count),
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
    weapons: { ...state.weapons },
    activeWeapon: state.activeWeapon,
    asteroidsMined: state.asteroidsMined,
    buffs: state.buffs.map(({ kind, remaining }) => ({ kind, remaining })),
    cometsCaught: state.cometsCaught,
    sectorSeed: state.sectorSeed,
    location: state.location,
    course: state.course && { ...state.course },
    visited: [...state.visited],
    modules: [...state.modules],
    equipped: [...state.equipped],
    darkMatter: state.darkMatter,
    jumps: state.jumps,
    clicks: state.clicks,
    lifetimeEnergy: state.lifetimeEnergy,
  }
}

const isModule = (id: string): id is ModuleId => MODULES.some((m) => m.id === id)

/** Restores where the ship is, dropping anything that does not exist in this sector. */
function loadTravel(data: SaveData, initial: GameState) {
  // Saves from before the map get a sector of their own.
  const sectorSeed = data.sectorSeed ?? newSectorSeed()
  const sector = sectorFor(sectorSeed)
  const exists = (id: string | null | undefined): id is string => !!findSystem(sector, id ?? null)
  const course = data.course && exists(data.course.to) ? data.course : null
  const location = course ? null : exists(data.location) ? data.location : initial.location
  const modules = [...new Set(data.modules ?? [])].filter(isModule)
  const equipped = [...new Set(data.equipped ?? [])]
    .filter((id): id is ModuleId => isModule(id) && modules.includes(id))
    .slice(0, MODULE_SLOTS)
  return {
    sectorSeed,
    location,
    course,
    visited: [...new Set([HOME_ID, ...(data.visited ?? []).filter(exists)])],
    modules,
    equipped,
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
  const weapons = { ...initial.weapons }
  for (const weapon of WEAPONS) {
    if (weapon.id !== 'pulse')
      weapons[weapon.id] = Math.min(data.weapons?.[weapon.id] ?? 0, WEAPON_MAX_LEVEL)
  }
  const activeWeapon =
    WEAPONS.find((w) => w.id === data.activeWeapon && weapons[w.id] > 0)?.id ?? 'pulse'

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
      weapons,
      activeWeapon,
      asteroidsMined: data.asteroidsMined ?? 0,
      buffs: loadBuffs(data.buffs),
      cometsCaught: data.cometsCaught ?? 0,
      ...loadTravel(data, initial),
      darkMatter: data.darkMatter ?? 0,
      jumps: data.jumps ?? 0,
      clicks: data.clicks,
      lifetimeEnergy: data.lifetimeEnergy,
    },
  }
}

export function migrateLegacy(raw: unknown, now: number): LoadedGame | null {
  const parsed = legacySchema.safeParse(raw)
  if (!parsed.success) return null
  const legacy = parsed.data
  const initial = createInitialState(newSectorSeed())

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
