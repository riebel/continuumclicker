import { MODULE_MIN_RING, MODULES, type ModuleId, SECTOR_RINGS, type SystemKind } from './content'
import { mulberry32 } from './random'

export type AnomalyContent = 'cache' | 'overdrive' | 'module'

export interface Offer {
  readonly module: ModuleId
  readonly price: number
}

export interface StarSystem {
  readonly id: string
  readonly name: string
  readonly kind: SystemKind
  /** Index into SECTOR_RINGS, -1 for the home station. */
  readonly ring: number
  /** Position in km, home at the origin. */
  readonly x: number
  readonly y: number
  /** Distance from home in km. */
  readonly distance: number
  /** Modules for sale at an inhabited world. */
  readonly offers: readonly Offer[]
  /** Module salvaged from a derelict or found in an anomaly on the first visit. */
  readonly find: ModuleId | null
  /** What an anomaly turns out to be. Unknown to the player until they visit. */
  readonly anomaly: AnomalyContent | null
}

export interface Sector {
  readonly seed: number
  readonly systems: readonly StarSystem[]
}

export const HOME_ID = 'home'

const SYLLABLES = [
  'ka',
  'vel',
  'or',
  'dra',
  'ne',
  'sti',
  'qua',
  'ris',
  'mo',
  'tha',
  'xe',
  'lun',
  'cor',
  'an',
  'bel',
  'ty',
  'zar',
  'io',
  'pe',
  'gan',
  'sol',
  'ur',
  'kha',
  'ven',
] as const
const NUMERALS = ['II', 'III', 'IV', 'V', 'VI', 'VII'] as const

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T
}

function shuffle<T>(random: () => number, items: readonly T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j] as T, result[i] as T]
  }
  return result
}

function makeName(random: () => number, kind: SystemKind, used: Set<string>): string {
  for (;;) {
    const length = random() < 0.6 ? 2 : 3
    const stem = Array.from({ length }, () => pick(random, SYLLABLES)).join('')
    const base = stem.charAt(0).toUpperCase() + stem.slice(1)
    const name =
      kind === 'belt'
        ? `${base} Belt`
        : kind === 'world'
          ? `${base} ${pick(random, NUMERALS)}`
          : kind === 'derelict'
            ? `Derelict ${base}`
            : `${base} Anomaly`
    if (!used.has(name)) {
      used.add(name)
      return name
    }
  }
}

interface Draft {
  id: string
  name: string
  kind: SystemKind
  ring: number
  x: number
  y: number
  distance: number
  offers: Offer[]
  find: ModuleId | null
  anomaly: AnomalyContent | null
}

/**
 * Generates the sector for a seed. Deterministic, so only the seed is saved. Every module is
 * placed at least once, within a ring of where it may first appear, so a bad seed never locks
 * the player out of anything.
 */
export function generateSector(seed: number): Sector {
  const random = mulberry32(seed)
  const used = new Set<string>()
  const systems: Draft[] = [
    {
      id: HOME_ID,
      name: 'Continuum Station',
      kind: 'home',
      ring: -1,
      x: 0,
      y: 0,
      distance: 0,
      offers: [],
      find: null,
      anomaly: null,
    },
  ]

  for (const [ring, def] of SECTOR_RINGS.entries()) {
    const kinds = shuffle(random, def.kinds)
    const offset = random() * Math.PI * 2
    for (const [i, kind] of kinds.entries()) {
      const angle = offset + (i / kinds.length) * Math.PI * 2 + (random() - 0.5) * 0.9
      // Log-uniform, so every ring spans its whole range evenly on the map.
      const distance = def.minKm * (def.maxKm / def.minKm) ** random()
      systems.push({
        id: `s${ring}-${i}`,
        name: makeName(random, kind, used),
        kind,
        ring,
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        distance,
        offers: [],
        find: null,
        anomaly: kind === 'anomaly' ? (random() < 0.5 ? 'cache' : 'overdrive') : null,
      })
    }
  }

  // Place each module once: a world sells up to two, a derelict or anomaly holds one.
  const capacity = (s: Draft) =>
    s.kind === 'world'
      ? 2 - s.offers.length
      : s.kind === 'derelict' || s.kind === 'anomaly'
        ? s.find
          ? 0
          : 1
        : 0
  const modules = [...MODULES].sort((a, b) => MODULE_MIN_RING[a.id] - MODULE_MIN_RING[b.id])
  for (const { id } of modules) {
    const min = MODULE_MIN_RING[id]
    const open = systems.filter((s) => s.ring >= min && capacity(s) > 0)
    const soon = open.filter((s) => s.ring <= min + 1)
    const source = pick(random, soon.length > 0 ? soon : open)
    if (source.kind === 'world') {
      const price = (SECTOR_RINGS[source.ring]?.price ?? 0) * (1 + random() * 0.5)
      source.offers.push({ module: id, price: Math.round(price / 1000) * 1000 })
    } else {
      source.find = id
      if (source.kind === 'anomaly') source.anomaly = 'module'
    }
  }

  return { seed, systems }
}

/** A fresh seed for a new game's sector. */
export function newSectorSeed(random: () => number = Math.random): number {
  return Math.floor(random() * 2 ** 31)
}

let cached: Sector | null = null

/** The sector for a seed, generated once and reused. */
export function sectorFor(seed: number): Sector {
  if (cached?.seed !== seed) cached = generateSector(seed)
  return cached
}

export function findSystem(sector: Sector, id: string | null): StarSystem | undefined {
  return id === null ? undefined : sector.systems.find((s) => s.id === id)
}

export function distanceBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
