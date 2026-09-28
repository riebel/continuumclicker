/** Speed of light in km/h. */
export const SPEED_OF_LIGHT_KMH = 1_079_252_848.8

/** One light-year in km. */
export const LIGHT_YEAR_KM = 9_460_730_472_580.8

/** One astronomical unit (mean Earth–Sun distance) in km. */
export const ASTRONOMICAL_UNIT_KM = 149_597_870.7

/** Every purchase of an upgrade makes the next one this much more expensive. */
export const COST_GROWTH = 1.15

/** Energy drain (per second) of a speed level is its fraction of c divided by this. */
const DRAIN_PER_C = 0.0008895

/**
 * Upgrade tiers are tuned so that the payback time (cost / eps) grows steadily from tier to tier
 * and a new tier unlocks every 5–30 minutes. `balance.test.ts` plays the game with a bot and
 * guards that pacing, run it after changing any number here.
 */
export interface UpgradeDef {
  readonly id: string
  readonly name: string
  readonly baseCost: number
  /** Energy per second produced by each owned unit, before milestone multipliers. */
  readonly eps: number
}

export interface SpeedLevelDef {
  readonly id: string
  readonly name: string
  /** Speed as a multiple of the speed of light. */
  readonly c: number
  /** Energy consumed per second while this level is engaged. */
  readonly drain: number
}

export const UPGRADES = [
  { id: 'avidyne-engine', name: 'Avidyne engine', baseCost: 15, eps: 0.1 },
  { id: 'accelerator-generator', name: 'Accelerator-generator', baseCost: 100, eps: 0.6 },
  { id: 'driver-coil', name: 'Driver coil', baseCost: 600, eps: 3 },
  { id: 'impulse-capacitance-cell', name: 'Impulse capacitance cell', baseCost: 4_000, eps: 15 },
  { id: 'impulse-control-system', name: 'Impulse control system', baseCost: 25_000, eps: 70 },
  { id: 'impulse-deck', name: 'Impulse deck', baseCost: 200_000, eps: 400 },
  { id: 'impulse-jet', name: 'Impulse jet', baseCost: 1_200_000, eps: 1_800 },
  { id: 'impulse-matrix', name: 'Impulse matrix', baseCost: 7_500_000, eps: 8_000 },
  { id: 'impulse-nacelle', name: 'Impulse nacelle', baseCost: 40_000_000, eps: 36_000 },
  { id: 'impulse-reactor', name: 'Impulse reactor', baseCost: 250_000_000, eps: 150_000 },
  {
    id: 'impulse-response-filter',
    name: 'Impulse response filter',
    baseCost: 1_600_000_000,
    eps: 700_000,
  },
] as const satisfies readonly UpgradeDef[]

export type UpgradeId = (typeof UPGRADES)[number]['id']

/**
 * Every upgrade has a module on the 3D ship (see blender/build_ship.py). Its next tier appears
 * when the owned count reaches the next threshold.
 */
export const VISUAL_TIER_THRESHOLDS = [1, 5, 10, 25, 50] as const

/**
 * Owning this many units of an upgrade doubles its output. They coincide with the last three
 * module tiers, so the ship visibly grows whenever production jumps.
 */
export const PRODUCTION_MILESTONES = [10, 25, 50] as const
export const MILESTONE_MULTIPLIER = 2

const level = (id: string, name: string, c: number): SpeedLevelDef => ({
  id,
  name,
  c,
  drain: Math.ceil(c / DRAIN_PER_C),
})

export const SPEED_LEVELS: readonly SpeedLevelDef[] = [
  level('stop', 'Full stop', 0),
  level('orbit', 'Standard orbit', 0.0008895),
  level('impulse-1-8', '⅛ impulse', 0.03125),
  level('impulse-1-4', '¼ impulse', 0.0625),
  level('impulse-1-2', '½ impulse', 0.125),
  level('impulse-full', 'Full impulse', 0.25),
  level('warp-1', 'Warp 1', 1),
  level('warp-2', 'Warp 2', 10),
  level('warp-3', 'Warp 3', 39),
  level('warp-4', 'Warp 4', 102),
  level('warp-5', 'Warp 5', 214),
  level('warp-6', 'Warp 6', 392),
  level('warp-7', 'Warp 7', 656),
  level('warp-8', 'Warp 8', 1_024),
  level('warp-9', 'Warp 9', 1_516),
  level('warp-9.2', 'Warp 9.2', 1_649),
  level('warp-9.6', 'Warp 9.6', 1_909),
  level('warp-9.9', 'Warp 9.9', 3_053),
  level('warp-9.99', 'Warp 9.99', 7_912),
  level('warp-9.9999', 'Warp 9.9999', 199_516),
]

export const MAX_DRAIN = SPEED_LEVELS.at(-1)?.drain ?? 1

export const CLICK = {
  energy: 1,
  criticalChance: 0.05,
  criticalMultiplier: 2,
} as const
