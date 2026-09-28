import {
  ASTEROIDS,
  COMETS,
  COST_GROWTH,
  LASER,
  LASER_UPGRADES,
  type LaserUpgradeDef,
  type LaserUpgradeId,
  MAX_DRAIN,
  MILESTONE_MULTIPLIER,
  PRODUCTION_MILESTONES,
  SPEED_LEVELS,
  SPEED_OF_LIGHT_KMH,
  type SpeedLevelDef,
  UPGRADES,
  type UpgradeDef,
  type UpgradeId,
  VISUAL_TIER_THRESHOLDS,
} from './content'

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
  /** The asteroid in the mining laser's sights. Not saved: a fresh one is found on load. */
  readonly asteroid: Asteroid
  readonly asteroidsMined: number
  readonly buffs: readonly Buff[]
  readonly cometsCaught: number
  /** Laser shots fired. */
  readonly clicks: number
  /** All energy ever gained, from clicks and production. */
  readonly lifetimeEnergy: number
}

export function createInitialState(): GameState {
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
    asteroidsMined: 0,
    buffs: [],
    cometsCaught: 0,
    clicks: 0,
    lifetimeEnergy: 0,
  }
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

/** Combined multiplier of all active buffs of one kind. */
export function buffMultiplier(state: GameState, kind: BuffKind): number {
  return state.buffs.reduce((product, b) => (b.kind === kind ? product * b.multiplier : product), 1)
}

/** Energy produced per second by all owned upgrades, boosted by an active overdrive. */
export function production(state: GameState): number {
  const base = UPGRADES.reduce((sum, u) => sum + upgradeProduction(u, state.owned[u.id]), 0)
  return base * buffMultiplier(state, 'overdrive')
}

/** Energy consumed per second by the engaged speed level. */
export function drain(state: GameState): number {
  return speedLevelOf(state).drain
}

/** Net energy change per second. Negative while flying faster than the reactors can sustain. */
export function netRate(state: GameState): number {
  return production(state) - drain(state)
}

/** Fastest speed level whose drain is fully covered by production. Always exists (full stop). */
export function sustainableLevel(prod: number): number {
  return SPEED_LEVELS.findLastIndex((level) => level.drain <= prod)
}

export type SpeedLevelStatus = 'engaged' | 'sustainable' | 'burst' | 'locked'

/**
 * - `sustainable`: production covers the drain, you can cruise indefinitely.
 * - `burst`: stored energy covers at least one second, but it will run dry.
 * - `locked`: not enough energy to engage.
 */
export function speedLevelStatus(state: GameState, index: number): SpeedLevelStatus {
  if (index === state.speedLevel) return 'engaged'
  const level = SPEED_LEVELS[index]
  if (!level) return 'locked'
  if (level.drain <= production(state)) return 'sustainable'
  if (level.drain <= state.energy) return 'burst'
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
  return hit * buffMultiplier(state, 'laser-frenzy')
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
  const rockHits = (1 - crystal.chance) * ((rock.minHp + rock.maxHp) / 2)
  const crystalHits = crystal.chance * crystal.hp
  const crystalShare = crystalHits / (rockHits + crystalHits)
  const kinds = 1 + crystalShare * (crystal.energyMultiplier - 1)
  const crits = 1 + critChance(state) * (critMultiplier(state) - 1)
  return hitEnergy(state) * kinds * (crits + breakBonus(state))
}

export function createAsteroid(random: () => number = Math.random): Asteroid {
  const { rock, crystal } = ASTEROIDS
  if (random() < crystal.chance) return { kind: 'crystal', hp: crystal.hp, maxHp: crystal.hp }
  const hp = rock.minHp + Math.floor(random() * (rock.maxHp - rock.minHp + 1))
  return { kind: 'rock', hp, maxHp: hp }
}

export interface Shot {
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
  const critical = vein || random() < critChance(state)
  const gained = critical ? hit * critMultiplier(state) : hit
  const target = { ...state.asteroid, hp: state.asteroid.hp - 1 }
  const broken = target.hp <= 0
  const bonus = broken ? hit * target.maxHp * breakBonus(state) : 0
  const earned = gained + bonus

  return {
    gained,
    critical,
    bonus,
    target,
    state: {
      ...state,
      energy: state.energy + earned,
      lifetimeEnergy: state.lifetimeEnergy + earned,
      clicks: state.clicks + 1,
      asteroid: broken ? createAsteroid(random) : target,
      asteroidsMined: state.asteroidsMined + (broken ? 1 : 0),
    },
  }
}

export interface AdvanceResult {
  readonly state: GameState
  /** True when the energy ran dry and the ship dropped to a sustainable speed. */
  readonly downshifted: boolean
}

/**
 * Advances the simulation by `seconds`. Exact regardless of step size, so the same function
 * handles a 16 ms animation frame and a week of offline progress: if the reserves run dry
 * part-way through, the distance up to that moment is kept and the ship drops to the fastest
 * speed its reactors can sustain for the remaining time.
 */
export function advance(state: GameState, seconds: number): AdvanceResult {
  let remaining = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
  let current = state
  let downshifted = false

  // Production changes whenever a buff runs out, so cruise from one expiry to the next.
  do {
    const step = Math.min(remaining, ...current.buffs.map((b) => b.remaining))
    const result = cruise(current, step)
    downshifted ||= result.downshifted
    remaining -= step
    current = {
      ...result.state,
      buffs: current.buffs
        .map((b) => ({ ...b, remaining: b.remaining - step }))
        .filter((b) => b.remaining > 1e-9),
    }
  } while (remaining > 0)

  return { state: current, downshifted }
}

/** Advances by `seconds` at constant production. */
function cruise(state: GameState, seconds: number): AdvanceResult {
  let remaining = seconds
  let { energy, distance, speedLevel, lifetimeEnergy } = state
  let downshifted = false
  const prod = production(state)
  lifetimeEnergy += prod * remaining

  while (remaining > 0) {
    const level = SPEED_LEVELS[speedLevel] ?? (SPEED_LEVELS[0] as SpeedLevelDef)
    const net = prod - level.drain
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
    speedLevel = sustainableLevel(prod)
    downshifted = true
  }

  return { state: { ...state, energy, distance, speedLevel, lifetimeEnergy }, downshifted }
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
      Math.min(state.energy * bankShare, production(state) * productionSeconds) +
      hits * hitEnergy(state)
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
