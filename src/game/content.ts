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

/** The mining laser. Every click or tap fires one shot at the targeted asteroid. */
export const LASER = {
  /** Energy of a hit before upgrades. */
  baseEnergy: 1,
  /** Share of gross reactor output added to every hit. */
  productionShare: 0.045,
  critChance: 0.05,
  critMultiplier: 3,
  /** Energy for breaking an asteroid, as a share of the value of all hits it took. */
  breakBonus: 0.5,
  /** Shots per second while the fire button is held down. */
  autoFireRate: 4,
  /** Heavy fractures recover a diminishing share of additional damage as usable energy. */
  salvoRecovery: 0.24,
} as const

export const ASTEROIDS = {
  rock: { minHp: 3, maxHp: 6 },
  /** Rare, tougher, and every hit is worth `energyMultiplier` times as much. */
  crystal: { chance: 0.06, hp: 10, energyMultiplier: 3 },
} as const

/**
 * A glowing vein that now and then opens up on the asteroid. Striking it is a guaranteed
 * critical hit, a small reward for paying attention while holding the fire button.
 */
export const CRYSTAL_VEIN = {
  /** Chance per shot that a vein opens up, if none is showing. */
  chance: 0.08,
  /** Seconds before it closes again. */
  lifetime: 2.5,
} as const

/**
 * Comets cross the screen now and then while the game is open. Catching one grants a random
 * reward. Only active players benefit, so they are tuned as a bonus on top of mining, not a
 * necessity: `balance.test.ts` checks how much they add.
 */
export const COMETS = {
  /** Seconds until the first comet after opening the game. */
  firstAfter: [40, 80],
  /** Seconds between one comet leaving and the next one appearing. */
  interval: [150, 330],
  /** Seconds a comet takes to cross the screen. */
  lifetime: 13,
  rewards: {
    /** Reactors run hot: production multiplied for a while. Hits scale with it too. */
    overdrive: { weight: 0.5, multiplier: 3, duration: 60 },
    /** Every laser hit is worth more for a few seconds. */
    'laser-frenzy': { weight: 0.2, multiplier: 7, duration: 15 },
    /** An instant payout: a share of the stored energy, capped by minutes of production. */
    windfall: { weight: 0.3, bankShare: 0.1, productionSeconds: 600, hits: 30 },
  },
} as const

export interface LaserUpgradeDef {
  readonly id: string
  readonly name: string
  /** What one level does. */
  readonly effect: string
  readonly baseCost: number
  /** Each level costs this much more than the one before. */
  readonly costGrowth: number
  readonly maxLevel?: number
}

export const LASER_UPGRADES = [
  {
    id: 'laser-amplifier',
    name: 'Laser amplifier',
    effect: 'Hits gain +1 energy and +0.15% of reactor output',
    baseCost: 50,
    costGrowth: 5,
  },
  {
    id: 'precision-scanner',
    name: 'Precision scanner',
    effect: '+2.5% critical hit chance',
    baseCost: 250,
    costGrowth: 4,
    maxLevel: 10,
  },
  {
    id: 'crystal-resonator',
    name: 'Crystal resonator',
    effect: 'Critical hits ×0.5 stronger, +10% break bonus',
    baseCost: 1_000,
    costGrowth: 4,
    maxLevel: 10,
  },
] as const satisfies readonly LaserUpgradeDef[]

export type LaserUpgradeId = (typeof LASER_UPGRADES)[number]['id']

/** Weapons share the laser's reactor scaling, but each has its own mining mechanic. */
export const WEAPONS = [
  {
    id: 'pulse',
    name: 'Pulse laser',
    tag: 'Reliable',
    color: '#ff934b',
    baseCost: 0,
    effect: 'One precise hit per shot. Your original mining laser.',
    special: 'Pulse',
  },
  {
    id: 'plasma',
    name: 'Plasma devastator',
    tag: 'Overcharge',
    color: '#ff4e9a',
    baseCost: 200,
    effect: 'Every third plasma discharge detonates for 4 damage. Upgrades add +1 blast damage.',
    special: 'Plasma detonation',
  },
  {
    id: 'railgun',
    name: 'Titan railgun',
    tag: 'Piercing',
    color: '#84ffbc',
    baseCost: 1_200,
    effect: 'Pierces for 2 damage, doubled against crystals. Upgrades add +1 damage.',
    special: 'Crystal pierced',
  },
  {
    id: 'tesla',
    name: 'Tesla arc array',
    tag: 'Chain lightning',
    color: '#bb8bff',
    baseCost: 6_000,
    effect:
      'On a kill, lightning hits the next rock for 2 damage, leaving at least 1 HP. Upgrades add +1 chain damage.',
    special: 'Chain lightning',
  },
  {
    id: 'cryo',
    name: 'Cryo shatter beam',
    tag: 'Freeze → shatter',
    color: '#65eaff',
    baseCost: 30_000,
    effect:
      'Freezes a rock, then shatters it for 3 damage and double energy. Upgrades add +1 shatter damage.',
    special: 'Ice shatter',
  },
  {
    id: 'swarm',
    name: 'Hydra missile swarm',
    tag: 'Multi-strike',
    color: '#ffd567',
    baseCost: 150_000,
    effect: 'Three missiles per salvo, +10% crit chance. Upgrades add another missile.',
    special: 'Missile salvo',
  },
  {
    id: 'singularity',
    name: 'Singularity projector',
    tag: 'Event horizon',
    color: '#798bff',
    baseCost: 1_000_000,
    effect:
      'Every fourth projector discharge collapses the asteroid for a triple break reward. Upgrades increase the reward.',
    special: 'Event horizon',
  },
] as const

export type WeaponId = (typeof WEAPONS)[number]['id']
export type WeaponDef = (typeof WEAPONS)[number]
export const WEAPON_MAX_LEVEL = 5
export const WEAPON_COST_GROWTH = 4

/** Independent hardpoints and automatic firing rhythm, counted in player volleys. */
export const WEAPON_SYSTEMS: Record<WeaponId, { mount: string; cadence: number; phase: number }> = {
  pulse: { mount: 'Forward turret', cadence: 1, phase: 0 },
  plasma: { mount: 'Twin shoulder cannons', cadence: 3, phase: 1 },
  railgun: { mount: 'Ventral rail spine', cadence: 2, phase: 1 },
  tesla: { mount: 'Twin dorsal coils', cadence: 4, phase: 0 },
  cryo: { mount: 'Twin underside emitters', cadence: 3, phase: 2 },
  swarm: { mount: 'Port & starboard missile batteries', cadence: 4, phase: 2 },
  singularity: { mount: 'Aft dorsal projector', cadence: 6, phase: 0 },
}

/** Combined module tiers reshape the whole silhouette, starting with the very first purchase. */
export const SHIP_FORMS = [
  { name: 'Scout', tiers: 0, detail: 'Compact mining vessel' },
  { name: 'Interceptor', tiers: 1, detail: 'Deployable wings & engine pods' },
  { name: 'Frigate', tiers: 4, detail: 'Armoured prow & expanded thrusters' },
  { name: 'Destroyer', tiers: 9, detail: 'Outboard nacelles & reactor halo' },
  { name: 'Battlecruiser', tiers: 16, detail: 'Command tower & heavy armour' },
  { name: 'Dreadnought', tiers: 26, detail: 'Twin spinal rails & siege wings' },
  { name: 'Star fortress', tiers: 40, detail: 'Orbital reactor rings & capital engines' },
] as const

/**
 * Rare ship modules found out in the sector. Only `MODULE_SLOTS` can be equipped at once, so
 * they are choices: fit the ship for mining, for travel or for idling.
 */
export const MODULES = [
  {
    id: 'chain-laser',
    name: 'Chain laser',
    effect: 'A broken asteroid cracks the next one: it starts 2 hits weaker.',
  },
  {
    id: 'crystal-scanner',
    name: 'Crystal scanner',
    effect: 'Crystal asteroids are 2.5× as common and crystal veins open twice as often.',
  },
  {
    id: 'mining-drones',
    name: 'Mining drones',
    effect: 'Drones mine on their own, 1 shot per second, even while you are away.',
  },
  {
    id: 'comet-lure',
    name: 'Comet lure',
    effect: 'Comets come 40% more often and stay 30% longer.',
  },
  {
    id: 'salvage-tractor',
    name: 'Salvage tractor',
    effect: 'Double energy from windfalls, first visits and salvage.',
  },
  {
    id: 'warp-field-tuner',
    name: 'Warp field tuner',
    effect: 'Every speed level drains 25% less energy.',
  },
] as const

export type ModuleId = (typeof MODULES)[number]['id']

export const MODULE_SLOTS = 3

export const MODULE_EFFECTS = {
  chainLaserDamage: 2,
  crystalScannerChance: 2.5,
  crystalScannerVeins: 2,
  droneShotsPerSecond: 1,
  cometLureFrequency: 1.4,
  cometLureLifetime: 1.3,
  salvageMultiplier: 2,
  warpTunerDrain: 0.75,
} as const

export type SystemKind = 'home' | 'belt' | 'world' | 'derelict' | 'anomaly'

/**
 * The sector is generated from a seed stored in the save, in rings around the home station.
 * Each ring is tuned to be a trip of 5–15 minutes at the speed a player typically reaches when
 * the ring becomes relevant, so faster engines always open up the next destinations.
 * `balance.test.ts` checks that against the simulated progression.
 */
export const SECTOR_RINGS = [
  // Within reach of impulse engines in the first minutes.
  { minKm: 5e5, maxKm: 4e6, kinds: ['belt', 'derelict'], price: 0 },
  // Around one AU: full impulse or warp 1.
  { minKm: 5e7, maxKm: 2.2e8, kinds: ['world', 'belt', 'anomaly'], price: 1e6 },
  // The outer planets: warp 2–3.
  { minKm: 5e8, maxKm: 2.2e9, kinds: ['world', 'derelict', 'belt'], price: 6e6 },
  // The Kuiper belt: warp 4–6.
  { minKm: 6e9, maxKm: 3e10, kinds: ['world', 'anomaly', 'derelict'], price: 1.5e8 },
  // The Oort cloud: warp 9.9 and above.
  { minKm: 4.7e11, maxKm: 2e12, kinds: ['world', 'belt', 'anomaly'], price: 8e9 },
  // Neighbouring stars: only maximum warp gets there in reasonable time.
  { minKm: 2.8e13, maxKm: 5.3e13, kinds: ['derelict', 'world'], price: 2e11 },
] as const satisfies readonly {
  minKm: number
  maxKm: number
  kinds: readonly SystemKind[]
  price: number
}[]

/** Where each module can turn up at the earliest, by ring index. */
export const MODULE_MIN_RING: Record<ModuleId, number> = {
  'chain-laser': 1,
  'crystal-scanner': 1,
  'mining-drones': 2,
  'comet-lure': 2,
  'warp-field-tuner': 3,
  'salvage-tractor': 3,
}

/**
 * Jumping to a new sector starts over with a fresh map, but collects dark matter from all the
 * energy ever generated: each unit permanently boosts production (and with it every hit).
 * The cube root makes every further unit cost more, so jumps pay off less and less often.
 */
export const DARK_MATTER = {
  /** Lifetime energy for the first unit: total units = cbrt(lifetime energy / base). */
  base: 1e9,
  /** Production bonus per unit. */
  bonus: 0.1,
} as const

export const VISITS = {
  /** First visit to any system: this many seconds of production, at least `minimum`. */
  firstVisitSeconds: 120,
  firstVisitMinimum: 50,
  /** Salvaging a derelict pays this many seconds of production on top. */
  salvageSeconds: 600,
  /** An anomaly's energy cache pays this many seconds of production. */
  anomalySeconds: 900,
  /** Docked at an asteroid belt: hits are worth more and crystals are more common. */
  beltHitMultiplier: 1.5,
  beltCrystalChance: 2,
  /** Travel time the scanners can see ahead at the fastest sustainable speed. */
  scanSeconds: 30 * 60,
} as const
