import {
  CLICK,
  COST_GROWTH,
  MAX_DRAIN,
  SPEED_LEVELS,
  SPEED_OF_LIGHT_KMH,
  type SpeedLevelDef,
  UPGRADES,
  type UpgradeDef,
  type UpgradeId,
} from './content'

export interface GameState {
  /** Stored energy. Never negative. */
  readonly energy: number
  /** Distance travelled in km. */
  readonly distance: number
  /** Index into SPEED_LEVELS. */
  readonly speedLevel: number
  readonly owned: Readonly<Record<UpgradeId, number>>
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
    clicks: 0,
    lifetimeEnergy: 0,
  }
}

export function upgradeCost(upgrade: Pick<UpgradeDef, 'baseCost'>, owned: number): number {
  return upgrade.baseCost * COST_GROWTH ** owned
}

export function speedLevelOf(state: GameState): SpeedLevelDef {
  return SPEED_LEVELS[state.speedLevel] ?? (SPEED_LEVELS[0] as SpeedLevelDef)
}

/** Current speed in km/h. */
export function speedKmh(state: GameState): number {
  return speedLevelOf(state).c * SPEED_OF_LIGHT_KMH
}

/** Energy produced per second by all owned upgrades. */
export function production(state: GameState): number {
  return UPGRADES.reduce((sum, u) => sum + u.eps * state.owned[u.id], 0)
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

export interface ClickResult {
  readonly state: GameState
  readonly gained: number
  readonly critical: boolean
}

export function click(state: GameState, random: () => number = Math.random): ClickResult {
  const critical = random() < CLICK.criticalChance
  const gained = critical ? CLICK.energy * CLICK.criticalMultiplier : CLICK.energy
  return {
    critical,
    gained,
    state: {
      ...state,
      energy: state.energy + gained,
      lifetimeEnergy: state.lifetimeEnergy + gained,
      clicks: state.clicks + 1,
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

/** 0‥1 intensity of the warp effect, used for the starfield. */
export function warpIntensity(state: GameState): number {
  const level = speedLevelOf(state)
  return level.drain > 0 ? (level.drain / MAX_DRAIN) ** 0.2 : 0
}
