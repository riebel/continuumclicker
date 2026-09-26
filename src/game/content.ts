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

export interface UpgradeDef {
  readonly id: string
  readonly name: string
  readonly baseCost: number
  /** Energy per second produced by each owned unit. */
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
  { id: 'accelerator-generator', name: 'Accelerator-generator', baseCost: 100, eps: 0.5 },
  { id: 'driver-coil', name: 'Driver coil', baseCost: 500, eps: 4 },
  { id: 'impulse-capacitance-cell', name: 'Impulse capacitance cell', baseCost: 3_000, eps: 10 },
  { id: 'impulse-control-system', name: 'Impulse control system', baseCost: 10_000, eps: 40 },
  { id: 'impulse-deck', name: 'Impulse deck', baseCost: 40_000, eps: 100 },
  { id: 'impulse-jet', name: 'Impulse jet', baseCost: 200_000, eps: 400 },
  { id: 'impulse-matrix', name: 'Impulse matrix', baseCost: 1_666_666, eps: 6_666 },
  { id: 'impulse-nacelle', name: 'Impulse nacelle', baseCost: 123_456_789, eps: 98_765 },
  { id: 'impulse-reactor', name: 'Impulse reactor', baseCost: 3_999_999_999, eps: 999_999 },
  {
    id: 'impulse-response-filter',
    name: 'Impulse response filter',
    baseCost: 75_000_000_000,
    eps: 10_000_000,
  },
] as const satisfies readonly UpgradeDef[]

export type UpgradeId = (typeof UPGRADES)[number]['id']

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
