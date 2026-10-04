import {
  ASTEROIDS,
  COMETS,
  COST_GROWTH,
  DARK_MATTER,
  LASER,
  LASER_UPGRADES,
  type LaserUpgradeDef,
  type LaserUpgradeId,
  MAX_DRAIN,
  MILESTONE_MULTIPLIER,
  MODULE_EFFECTS,
  MODULE_SLOTS,
  type ModuleId,
  PRODUCTION_MILESTONES,
  SHIP_FORMS,
  SPEED_LEVELS,
  SPEED_OF_LIGHT_KMH,
  type SpeedLevelDef,
  UPGRADES,
  type UpgradeDef,
  type UpgradeId,
  VISITS,
  VISUAL_TIER_THRESHOLDS,
  WEAPON_COST_GROWTH,
  WEAPON_MAX_LEVEL,
  WEAPONS,
  type WeaponDef,
  type WeaponId,
} from './content'
import { distanceBetween, findSystem, HOME_ID, type StarSystem, sectorFor } from './sector'

export type AsteroidKind = 'rock' | 'crystal'

export interface Asteroid {
  readonly kind: AsteroidKind
  /** Hits left until it breaks. */
  readonly hp: number
  readonly maxHp: number
}

export type BuffKind = 'overdrive' | 'laser-frenzy'

/** A temporary boost from a comet. */
export interface Buff {
  readonly kind: BuffKind
  readonly multiplier: number
  /** Seconds left. */
  readonly remaining: number
  readonly duration: number
}

export interface GameState {
  /** Stored energy. Never negative. */
  readonly energy: number
  /** Distance travelled in km. */
  readonly distance: number
  /** Index into SPEED_LEVELS. */
  readonly speedLevel: number
  readonly owned: Readonly<Record<UpgradeId, number>>
  readonly lasers: Readonly<Record<LaserUpgradeId, number>>
  readonly weapons: Readonly<Record<WeaponId, number>>
  readonly activeWeapon: WeaponId
  /** Charge and ice are local to the current weapon and target. */
  readonly weaponCharge: number
  readonly frozen: boolean
  /** The asteroid in the mining laser's sights. Not saved: a fresh one is found on load. */
  readonly asteroid: Asteroid
  readonly asteroidsMined: number
  readonly buffs: readonly Buff[]
  readonly cometsCaught: number
  /** Seed of this game's sector map. */
  readonly sectorSeed: number
  /** The system the ship is docked at, null while travelling. */
  readonly location: string | null
  readonly course: Course | null
  /** Systems visited at least once; their first-visit rewards are claimed. */
  readonly visited: readonly string[]
  /** Rare modules found or bought, and the ones fitted to the ship. */
  readonly modules: readonly ModuleId[]
  readonly equipped: readonly ModuleId[]
  /** Collected by jumping to new sectors; kept forever. */
  readonly darkMatter: number
  /** Sector jumps made so far. */
  readonly jumps: number
  /** Laser shots fired. */
  readonly clicks: number
  /** All energy ever gained, from clicks and production. */
  readonly lifetimeEnergy: number
}

/** A trip to a system. Distances in km. */
export interface Course {
  /** Where the trip started. */
  readonly fromX: number
  readonly fromY: number
  readonly to: string
  readonly length: number
  readonly travelled: number
}

export function createInitialState(sectorSeed = 1): GameState {
  return {
    energy: 0,
    distance: 0,
    speedLevel: 0,
    owned: Object.fromEntries(UPGRADES.map((u) => [u.id, 0])) as Record<UpgradeId, number>,
    lasers: Object.fromEntries(LASER_UPGRADES.map((u) => [u.id, 0])) as Record<
      LaserUpgradeId,
      number
    >,
    asteroid: { kind: 'rock', hp: 4, maxHp: 4 },
    weapons: Object.fromEntries(WEAPONS.map((w) => [w.id, w.id === 'pulse' ? 1 : 0])) as Record<
      WeaponId,
      number
    >,
    activeWeapon: 'pulse',
    weaponCharge: 0,
    frozen: false,
    asteroidsMined: 0,
    buffs: [],
    cometsCaught: 0,
    sectorSeed,
    location: HOME_ID,
    course: null,
    visited: [HOME_ID],
    modules: [],
    equipped: [],
    darkMatter: 0,
    jumps: 0,
    clicks: 0,
    lifetimeEnergy: 0,
  }
}

export function hasModule(state: GameState, id: ModuleId): boolean {
  return state.equipped.includes(id)
}

/** The system the ship is docked at. */
export function dockedAt(state: GameState): StarSystem | undefined {
  return findSystem(sectorFor(state.sectorSeed), state.location)
}

export function upgradeCost(upgrade: Pick<UpgradeDef, 'baseCost'>, owned: number): number {
  return upgrade.baseCost * COST_GROWTH ** owned
}

/** Number of ship module tiers unlocked by owning `owned` units of an upgrade (0-5). */
export function visualTier(owned: number): number {
  return VISUAL_TIER_THRESHOLDS.filter((threshold) => owned >= threshold).length
}

/** Owned count at which the next module tier appears, or null when fully built. */
export function nextVisualTierAt(owned: number): number | null {
  return VISUAL_TIER_THRESHOLDS.find((threshold) => owned < threshold) ?? null
}

export function shipModuleTiers(state: GameState): number {
  return UPGRADES.reduce((sum, upgrade) => sum + visualTier(state.owned[upgrade.id]), 0)
}

export function shipForm(state: GameState): number {
  const tiers = shipModuleTiers(state)
  return Math.max(
    0,
    SHIP_FORMS.findLastIndex((form) => tiers >= form.tiers),
  )
}

export function weaponCost(weapon: WeaponDef, level: number): number {
  return weapon.baseCost * WEAPON_COST_GROWTH ** level
}

export function selectWeapon(state: GameState, id: WeaponId): GameState {
  if (!WEAPONS.some((w) => w.id === id) || !state.weapons[id] || state.activeWeapon === id)
    return state
  return { ...state, activeWeapon: id, weaponCharge: 0, frozen: false }
}

export function buyWeapon(state: GameState, id: WeaponId): GameState {
  const weapon = WEAPONS.find((w) => w.id === id)
  if (!weapon || id === 'pulse' || state.weapons[id] >= WEAPON_MAX_LEVEL) return state
  const cost = weaponCost(weapon, state.weapons[id])
  if (state.energy < cost) return state
  const next = {
    ...state,
    energy: state.energy - cost,
    weapons: { ...state.weapons, [id]: state.weapons[id] + 1 },
  }
  return state.weapons[id] === 0 ? selectWeapon(next, id) : next
}

/** Output multiplier from production milestones reached by owning `owned` units. */
export function milestoneMultiplier(owned: number): number {
  return MILESTONE_MULTIPLIER ** PRODUCTION_MILESTONES.filter((m) => owned >= m).length
}

/** Owned count at which the output doubles next, or null when every milestone is reached. */
export function nextMilestoneAt(owned: number): number | null {
  return PRODUCTION_MILESTONES.find((m) => owned < m) ?? null
}

/** Energy per second produced by `owned` units of an upgrade. */
export function upgradeProduction(upgrade: Pick<UpgradeDef, 'eps'>, owned: number): number {
  return upgrade.eps * owned * milestoneMultiplier(owned)
}

export function speedLevelOf(state: GameState): SpeedLevelDef {
  return SPEED_LEVELS[state.speedLevel] ?? (SPEED_LEVELS[0] as SpeedLevelDef)
}

/** Current speed in km/h. */
export function speedKmh(state: GameState): number {
  return speedLevelOf(state).c * SPEED_OF_LIGHT_KMH
}

/** Production multiplier from dark matter. */
export function darkMatterBonus(state: GameState): number {
  return 1 + DARK_MATTER.bonus * state.darkMatter
}

/** Dark matter that all energy ever generated is worth in total. */
export function darkMatterFor(lifetimeEnergy: number): number {
  return Math.floor(Math.cbrt(Math.max(0, lifetimeEnergy) / DARK_MATTER.base))
}

/** Dark matter a sector jump would collect right now. */
export function pendingDarkMatter(state: GameState): number {
  return Math.max(0, darkMatterFor(state.lifetimeEnergy) - state.darkMatter)
}

/**
 * Jumps to a new sector: everything starts over except dark matter, which grows by what is
 * pending, and the captain's lifetime statistics.
 */
export function jumpSector(state: GameState, sectorSeed: number): GameState {
  const pending = pendingDarkMatter(state)
  if (pending <= 0) return state
  return {
    ...createInitialState(sectorSeed),
    darkMatter: state.darkMatter + pending,
    jumps: state.jumps + 1,
    lifetimeEnergy: state.lifetimeEnergy,
    clicks: state.clicks,
    asteroidsMined: state.asteroidsMined,
    cometsCaught: state.cometsCaught,
  }
}

/** Combined multiplier of all active buffs of one kind. */
export function buffMultiplier(state: GameState, kind: BuffKind): number {
  return state.buffs.reduce((product, b) => (b.kind === kind ? product * b.multiplier : product), 1)
}

/** Energy produced per second by all owned upgrades, boosted by an active overdrive. */
export function production(state: GameState): number {
  const base = UPGRADES.reduce((sum, u) => sum + upgradeProduction(u, state.owned[u.id]), 0)
  return base * darkMatterBonus(state) * buffMultiplier(state, 'overdrive')
}

/** Energy per second mined by drones, if they are fitted. Also runs while the player is away. */
export function droneIncome(state: GameState): number {
  if (!hasModule(state, 'mining-drones')) return 0
  return MODULE_EFFECTS.droneShotsPerSecond * expectedHitEnergy(state)
}

/** Energy gained per second without the player: reactors plus drones. */
export function income(state: GameState): number {
  return production(state) + droneIncome(state)
}

/** Drain multiplier from the fitted modules. */
function drainFactor(state: GameState): number {
  return hasModule(state, 'warp-field-tuner') ? MODULE_EFFECTS.warpTunerDrain : 1
}

/** Energy per second a speed level consumes for this ship. */
export function levelDrain(state: GameState, index: number): number {
  return (SPEED_LEVELS[index]?.drain ?? 0) * drainFactor(state)
}

/** Energy consumed per second by the engaged speed level. */
export function drain(state: GameState): number {
  return levelDrain(state, state.speedLevel)
}

/** Net energy change per second. Negative while flying faster than the reactors can sustain. */
export function netRate(state: GameState): number {
  return income(state) - drain(state)
}

/**
 * Fastest speed level whose drain is fully covered by `perSecond` of income. Always exists
 * (full stop). `drainFactor` accounts for a warp field tuner.
 */
export function sustainableLevel(perSecond: number, factor = 1): number {
  return SPEED_LEVELS.findLastIndex((level) => level.drain * factor <= perSecond)
}

/** Fastest speed level this ship can hold indefinitely. */
export function fastestSustainable(state: GameState): number {
  return sustainableLevel(income(state), drainFactor(state))
}

export type SpeedLevelStatus = 'engaged' | 'sustainable' | 'burst' | 'locked'

/**
 * - `sustainable`: production covers the drain, you can cruise indefinitely.
 * - `burst`: stored energy covers at least one second, but it will run dry.
 * - `locked`: not enough energy to engage.
 */
export function speedLevelStatus(state: GameState, index: number): SpeedLevelStatus {
  if (index === state.speedLevel) return 'engaged'
  if (!SPEED_LEVELS[index]) return 'locked'
  const cost = levelDrain(state, index)
  if (cost <= income(state)) return 'sustainable'
  if (cost <= state.energy) return 'burst'
  return 'locked'
}

export function canEngage(state: GameState, index: number): boolean {
  return speedLevelStatus(state, index) !== 'locked'
}

export function engage(state: GameState, index: number): GameState {
  if (!canEngage(state, index) || index === state.speedLevel) return state
  return { ...state, speedLevel: index }
}

export function canBuy(state: GameState, id: UpgradeId): boolean {
  const upgrade = UPGRADES.find((u) => u.id === id)
  return upgrade !== undefined && upgradeCost(upgrade, state.owned[id]) <= state.energy
}

export function buyUpgrade(state: GameState, id: UpgradeId): GameState {
  const upgrade = UPGRADES.find((u) => u.id === id)
  if (!upgrade) return state
  const cost = upgradeCost(upgrade, state.owned[id])
  if (cost > state.energy) return state
  return {
    ...state,
    energy: state.energy - cost,
    owned: { ...state.owned, [id]: state.owned[id] + 1 },
  }
}

export function laserCost(upgrade: LaserUpgradeDef, level: number): number {
  return upgrade.baseCost * upgrade.costGrowth ** level
}

export function isLaserMaxed(state: GameState, id: LaserUpgradeId): boolean {
  const upgrade: LaserUpgradeDef | undefined = LASER_UPGRADES.find((u) => u.id === id)
  return upgrade?.maxLevel !== undefined && state.lasers[id] >= upgrade.maxLevel
}

export function canBuyLaser(state: GameState, id: LaserUpgradeId): boolean {
  const upgrade = LASER_UPGRADES.find((u) => u.id === id)
  return (
    upgrade !== undefined &&
    !isLaserMaxed(state, id) &&
    laserCost(upgrade, state.lasers[id]) <= state.energy
  )
}

export function buyLaser(state: GameState, id: LaserUpgradeId): GameState {
  const upgrade = LASER_UPGRADES.find((u) => u.id === id)
  if (!upgrade || !canBuyLaser(state, id)) return state
  return {
    ...state,
    energy: state.energy - laserCost(upgrade, state.lasers[id]),
    lasers: { ...state.lasers, [id]: state.lasers[id] + 1 },
  }
}

/**
 * Energy of a regular hit on a rock. Grows with the reactors (gross output, so flying fast does
 * not weaken the laser), which keeps mining worthwhile at every stage of the game.
 */
export function hitEnergy(state: GameState): number {
  const amplifier = state.lasers['laser-amplifier']
  const share = LASER.productionShare + 0.002 * amplifier
  const hit = LASER.baseEnergy * (1 + amplifier) + share * production(state)
  const belt = dockedAt(state)?.kind === 'belt' ? VISITS.beltHitMultiplier : 1
  return hit * belt * buffMultiplier(state, 'laser-frenzy')
}

/** Chance that the next asteroid is a crystal one: higher in a belt or with a scanner. */
export function crystalChance(state: GameState): number {
  const scanner = hasModule(state, 'crystal-scanner') ? MODULE_EFFECTS.crystalScannerChance : 1
  const belt = dockedAt(state)?.kind === 'belt' ? VISITS.beltCrystalChance : 1
  return Math.min(0.5, ASTEROIDS.crystal.chance * scanner * belt)
}

export function critChance(state: GameState): number {
  return LASER.critChance + 0.025 * state.lasers['precision-scanner']
}

export function critMultiplier(state: GameState): number {
  return LASER.critMultiplier + 0.5 * state.lasers['crystal-resonator']
}

/** Break bonus as a share of the value of all regular hits the asteroid took. */
export function breakBonus(state: GameState): number {
  return LASER.breakBonus + 0.1 * state.lasers['crystal-resonator']
}

function kindMultiplier(kind: AsteroidKind): number {
  return kind === 'crystal' ? ASTEROIDS.crystal.energyMultiplier : 1
}

/** Average energy per shot over many asteroids: crits, break bonuses and crystals included. */
export function expectedHitEnergy(state: GameState): number {
  const { rock, crystal } = ASTEROIDS
  const chance = crystalChance(state)
  const rockHits = (1 - chance) * ((rock.minHp + rock.maxHp) / 2)
  const crystalHits = chance * crystal.hp
  const crystalShare = crystalHits / (rockHits + crystalHits)
  const kinds = 1 + crystalShare * (crystal.energyMultiplier - 1)
  const crits = 1 + critChance(state) * (critMultiplier(state) - 1)
  return hitEnergy(state) * kinds * (crits + breakBonus(state))
}

export function createAsteroid(
  random: () => number = Math.random,
  chance: number = ASTEROIDS.crystal.chance,
): Asteroid {
  const { rock, crystal } = ASTEROIDS
  if (random() < chance) return { kind: 'crystal', hp: crystal.hp, maxHp: crystal.hp }
  const hp = rock.minHp + Math.floor(random() * (rock.maxHp - rock.minHp + 1))
  return { kind: 'rock', hp, maxHp: hp }
}

export interface Shot {
  readonly weapon: WeaponId
  readonly special: string | null
  readonly damage: number
  readonly chained: number
  /** Energy from the hit itself. */
  readonly gained: number
  readonly critical: boolean
  /** Extra energy for breaking the asteroid, 0 if it survived. */
  readonly bonus: number
  /** The asteroid that was hit, after the hit. */
  readonly target: Asteroid
}

export interface ShotResult extends Shot {
  readonly state: GameState
}

/**
 * Fires the mining laser at the current asteroid. A broken asteroid is replaced right away.
 * Striking a crystal vein (`vein`) always crits.
 */
export function fire(
  state: GameState,
  random: () => number = Math.random,
  { vein = false }: { vein?: boolean } = {},
): ShotResult {
  const hit = hitEnergy(state) * kindMultiplier(state.asteroid.kind)
  const weapon = state.activeWeapon
  const level = state.weapons[weapon]
  const charge = state.weaponCharge + 1
  let damage = 1
  let multiplier = 1
  let bonusMultiplier = 1
  let special: string | null = null
  let frozen = false
  switch (weapon) {
    case 'plasma':
      if (charge % 3 === 0) {
        damage = 3 + level
        special = 'Plasma detonation'
      }
      break
    case 'railgun':
      damage = 1 + level
      if (state.asteroid.kind === 'crystal') {
        damage *= 2
        special = 'Crystal pierced'
      }
      break
    case 'cryo':
      if (state.frozen) {
        damage = 2 + level
        multiplier = 2
        special = 'Ice shatter'
      } else {
        frozen = true
        special = 'Target frozen'
      }
      break
    case 'swarm':
      damage = 2 + level
      special = `${damage} missile salvo`
      break
    case 'singularity':
      if (charge % 4 === 0) {
        damage = state.asteroid.hp
        bonusMultiplier = 2 + level
        special = 'Event horizon'
      }
      break
  }
  damage = Math.min(state.asteroid.hp, damage)
  const critical =
    vein || random() < Math.min(1, critChance(state) + (weapon === 'swarm' ? 0.1 : 0))
  const gained = hit * damage * multiplier * (critical ? critMultiplier(state) : 1)
  const target = { ...state.asteroid, hp: state.asteroid.hp - damage }
  const broken = target.hp <= 0
  let bonus = broken ? hit * target.maxHp * breakBonus(state) * bonusMultiplier : 0
  let chained = 0
  let next = target
  if (broken) {
    next = createAsteroid(random, crystalChance(state))
    if (weapon === 'tesla') {
      chained = Math.min(next.hp - 1, 1 + level)
      next = { ...next, hp: next.hp - chained }
      bonus += hitEnergy(state) * kindMultiplier(next.kind) * chained
      special = 'Chain lightning'
    }
    // A chain laser cracks the next asteroid as the last one breaks.
    if (hasModule(state, 'chain-laser')) {
      next = { ...next, hp: Math.max(1, next.hp - MODULE_EFFECTS.chainLaserDamage) }
    }
  }
  const earned = gained + bonus

  return {
    weapon,
    special,
    damage,
    chained,
    gained,
    critical,
    bonus,
    target,
    state: {
      ...state,
      energy: state.energy + earned,
      lifetimeEnergy: state.lifetimeEnergy + earned,
      clicks: state.clicks + 1,
      asteroid: next,
      weaponCharge: charge % 12,
      frozen: !broken && frozen,
      asteroidsMined: state.asteroidsMined + (broken ? 1 : 0),
    },
  }
}

/** What happened when the ship arrived somewhere. */
export interface Arrival {
  readonly system: string
  /** First visit: its rewards below were just claimed. */
  readonly firstVisit: boolean
  readonly energy: number
  /** Module salvaged or found. */
  readonly module: ModuleId | null
  /** An anomaly that turned out to overcharge the reactors. */
  readonly overdrive: boolean
}

export interface AdvanceResult {
  readonly state: GameState
  /** True when the energy ran dry and the ship dropped to a sustainable speed. */
  readonly downshifted: boolean
  readonly arrivals: readonly Arrival[]
}

/** Seconds until the ship arrives at its destination at the engaged speed. */
function secondsToArrival(state: GameState): number {
  const kmh = speedKmh(state)
  if (!state.course || kmh <= 0) return Number.POSITIVE_INFINITY
  return (Math.max(0, state.course.length - state.course.travelled) * 3600) / kmh
}

/**
 * Advances the simulation by `seconds`. Exact regardless of step size, so the same function
 * handles a 16 ms animation frame and a week of offline progress: if the reserves run dry
 * part-way through, the distance up to that moment is kept and the ship drops to the fastest
 * speed its reactors can sustain for the remaining time. A ship on course drops out of warp
 * exactly on arrival.
 */
export function advance(state: GameState, seconds: number): AdvanceResult {
  let remaining = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
  let current = state
  let downshifted = false
  const arrivals: Arrival[] = []

  // Income changes whenever a buff runs out and travel stops on arrival, so cruise from one of
  // these moments to the next.
  do {
    const step = Math.min(
      remaining,
      secondsToArrival(current),
      ...current.buffs.map((b) => b.remaining),
    )
    const result = cruise(current, step)
    downshifted ||= result.downshifted
    remaining -= step
    current = {
      ...result.state,
      buffs: current.buffs
        .map((b) => ({ ...b, remaining: b.remaining - step }))
        .filter((b) => b.remaining > 1e-9),
    }
    const course = current.course
    if (course && course.travelled >= course.length * (1 - 1e-12) - 1e-6) {
      const arrived = arrive(current, course.to)
      current = arrived.state
      arrivals.push(arrived.arrival)
    }
  } while (remaining > 0)

  return { state: current, downshifted, arrivals }
}

/** Advances by `seconds` at constant income. */
function cruise(state: GameState, seconds: number): Omit<AdvanceResult, 'arrivals'> {
  let remaining = seconds
  let { energy, distance, speedLevel, lifetimeEnergy } = state
  let downshifted = false
  const perSecond = income(state)
  const factor = drainFactor(state)
  lifetimeEnergy += perSecond * remaining

  while (remaining > 0) {
    const level = SPEED_LEVELS[speedLevel] ?? (SPEED_LEVELS[0] as SpeedLevelDef)
    const net = perSecond - level.drain * factor
    const speed = level.c * SPEED_OF_LIGHT_KMH
    const untilEmpty = net < 0 ? energy / -net : Number.POSITIVE_INFINITY

    if (untilEmpty >= remaining) {
      energy = Math.max(0, energy + net * remaining)
      distance += (speed * remaining) / 3600
      break
    }

    energy = 0
    distance += (speed * untilEmpty) / 3600
    remaining -= untilEmpty
    speedLevel = sustainableLevel(perSecond, factor)
    downshifted = true
  }

  const course = state.course && {
    ...state.course,
    travelled: state.course.travelled + (distance - state.distance),
  }
  return { state: { ...state, energy, distance, speedLevel, lifetimeEnergy, course }, downshifted }
}

/** Where the ship is, in km from home. */
export function position(state: GameState): { x: number; y: number } {
  const sector = sectorFor(state.sectorSeed)
  const { course } = state
  if (!course) {
    const docked = findSystem(sector, state.location)
    return { x: docked?.x ?? 0, y: docked?.y ?? 0 }
  }
  const target = findSystem(sector, course.to) ?? { x: 0, y: 0 }
  const t = course.length > 0 ? Math.min(1, course.travelled / course.length) : 1
  return {
    x: course.fromX + (target.x - course.fromX) * t,
    y: course.fromY + (target.y - course.fromY) * t,
  }
}

/** Plots a course from wherever the ship is. Changing course mid-flight is fine. */
export function setCourse(state: GameState, to: string): GameState {
  const target = findSystem(sectorFor(state.sectorSeed), to)
  if (!target || (state.location === to && !state.course)) return state
  const from = position(state)
  return {
    ...state,
    location: null,
    course: {
      fromX: from.x,
      fromY: from.y,
      to,
      length: distanceBetween(from, target),
      travelled: 0,
    },
  }
}

/** Seconds a trip to `system` takes at a speed level, Infinity if it does not move. */
export function travelSeconds(state: GameState, system: StarSystem, level: number): number {
  const kmh = (SPEED_LEVELS[level]?.c ?? 0) * SPEED_OF_LIGHT_KMH
  return kmh > 0
    ? (distanceBetween(position(state), system) * 3600) / kmh
    : Number.POSITIVE_INFINITY
}

/**
 * Whether the scanners can see what a system is: visited systems, and those the ship could
 * reach within `VISITS.scanSeconds` at its fastest sustainable speed. The innermost ring is
 * always in view.
 */
export function isScanned(state: GameState, system: StarSystem): boolean {
  if (system.ring <= 0 || state.visited.includes(system.id)) return true
  return travelSeconds(state, system, fastestSustainable(state)) <= VISITS.scanSeconds
}

function salvageMultiplier(state: GameState): number {
  return hasModule(state, 'salvage-tractor') ? MODULE_EFFECTS.salvageMultiplier : 1
}

/** Docks at a system; the first visit pays out its rewards. */
function arrive(state: GameState, id: string): { state: GameState; arrival: Arrival } {
  const docked: GameState = { ...state, location: id, course: null, speedLevel: 0 }
  const system = findSystem(sectorFor(state.sectorSeed), id)
  if (!system || state.visited.includes(id)) {
    return {
      state: docked,
      arrival: { system: id, firstVisit: false, energy: 0, module: null, overdrive: false },
    }
  }

  const prod = production(state)
  const salvage = salvageMultiplier(state)
  let energy = Math.max(VISITS.firstVisitMinimum, prod * VISITS.firstVisitSeconds)
  if (system.kind === 'derelict') energy += prod * VISITS.salvageSeconds
  if (system.anomaly === 'cache') energy += prod * VISITS.anomalySeconds
  energy *= salvage

  const module = system.find && !state.modules.includes(system.find) ? system.find : null
  const overdrive = system.anomaly === 'overdrive'
  const { multiplier, duration } = COMETS.rewards.overdrive
  const buffs = overdrive
    ? [
        ...state.buffs.filter((b) => b.kind !== 'overdrive'),
        { kind: 'overdrive' as const, multiplier, duration: duration * 2, remaining: duration * 2 },
      ]
    : state.buffs

  return {
    arrival: { system: id, firstVisit: true, energy, module, overdrive },
    state: {
      ...docked,
      energy: state.energy + energy,
      lifetimeEnergy: state.lifetimeEnergy + energy,
      visited: [...state.visited, id],
      modules: module ? [...state.modules, module] : state.modules,
      buffs,
    },
  }
}

/** Buys a module offered at the system the ship is docked at. */
export function buyModule(state: GameState, id: ModuleId): GameState {
  const offer = dockedAt(state)?.offers.find((o) => o.module === id)
  if (!offer || state.modules.includes(id) || offer.price > state.energy) return state
  return { ...state, energy: state.energy - offer.price, modules: [...state.modules, id] }
}

/** Fits an owned module into a free slot. */
export function equip(state: GameState, id: ModuleId): GameState {
  if (!state.modules.includes(id) || hasModule(state, id)) return state
  if (state.equipped.length >= MODULE_SLOTS) return state
  return { ...state, equipped: [...state.equipped, id] }
}

export function unequip(state: GameState, id: ModuleId): GameState {
  if (!hasModule(state, id)) return state
  return { ...state, equipped: state.equipped.filter((m) => m !== id) }
}

export type CometReward =
  | { readonly kind: BuffKind; readonly multiplier: number; readonly duration: number }
  | { readonly kind: 'windfall'; readonly energy: number }

export interface CometResult {
  readonly state: GameState
  readonly reward: CometReward
}

function pickReward(random: () => number): keyof typeof COMETS.rewards {
  const entries = Object.entries(COMETS.rewards) as [
    keyof typeof COMETS.rewards,
    { weight: number },
  ][]
  const total = entries.reduce((sum, [, r]) => sum + r.weight, 0)
  let roll = random() * total
  for (const [kind, reward] of entries) {
    roll -= reward.weight
    if (roll < 0) return kind
  }
  return 'windfall'
}

/** Catches a comet: a random buff, or an instant windfall of energy. */
export function catchComet(state: GameState, random: () => number = Math.random): CometResult {
  const kind = pickReward(random)
  const caught = { ...state, cometsCaught: state.cometsCaught + 1 }

  if (kind === 'windfall') {
    const { bankShare, productionSeconds, hits } = COMETS.rewards.windfall
    const energy =
      (Math.min(state.energy * bankShare, production(state) * productionSeconds) +
        hits * hitEnergy(state)) *
      salvageMultiplier(state)
    return {
      reward: { kind, energy },
      state: {
        ...caught,
        energy: state.energy + energy,
        lifetimeEnergy: state.lifetimeEnergy + energy,
      },
    }
  }

  const { multiplier, duration } = COMETS.rewards[kind]
  // Catching the same buff again refreshes it instead of stacking.
  const buffs = [
    ...state.buffs.filter((b) => b.kind !== kind),
    { kind, multiplier, duration, remaining: duration },
  ]
  return { reward: { kind, multiplier, duration }, state: { ...caught, buffs } }
}

/**
 * Average extra income from catching every comet, as a share of production and of mining
 * income. Windfalls are left out: they depend on how much energy the player hoards.
 */
export function expectedCometBoost(): { production: number; mining: number } {
  const { overdrive, 'laser-frenzy': frenzy } = COMETS.rewards
  const weights = Object.values(COMETS.rewards).reduce((sum, r) => sum + r.weight, 0)
  const cycle = (COMETS.interval[0] + COMETS.interval[1]) / 2 + COMETS.lifetime / 2
  const uptime = (r: { weight: number; duration: number }) =>
    (r.weight / weights) * (r.duration / cycle)
  const fromOverdrive = uptime(overdrive) * (overdrive.multiplier - 1)
  return {
    production: fromOverdrive,
    // Hits scale with production, so an overdrive boosts mining too.
    mining: fromOverdrive + uptime(frenzy) * (frenzy.multiplier - 1),
  }
}

/** 0‥1 intensity of the warp effect, used for the starfield. */
export function warpIntensity(state: GameState): number {
  const level = speedLevelOf(state)
  return level.drain > 0 ? (level.drain / MAX_DRAIN) ** 0.2 : 0
}
