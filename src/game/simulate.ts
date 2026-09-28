import {
  LASER,
  LASER_UPGRADES,
  type LaserUpgradeId,
  MAX_DRAIN,
  UPGRADES,
  type UpgradeId,
} from './content'
import {
  advance,
  buyLaser,
  buyUpgrade,
  createInitialState,
  expectedHitEnergy,
  type GameState,
  isLaserMaxed,
  laserCost,
  production,
  upgradeCost,
} from './engine'

/**
 * A bot that plays the economy, used to check the pacing of the game (see balance.test.ts).
 * It never flies, so all energy goes into upgrades: the fastest possible progression.
 */
export interface Playstyle {
  /** Laser shots per second while the player is mining. */
  readonly shotsPerSecond: number
  /** Stop mining once production reaches this many energy per second. */
  readonly mineUntilProduction: number
}

/** Holds the fire button the whole time. */
export const ACTIVE: Playstyle = {
  shotsPerSecond: LASER.autoFireRate,
  mineUntilProduction: Number.POSITIVE_INFINITY,
}
/** Mines only to afford the first reactor, then leaves the game running. */
export const IDLE: Playstyle = { shotsPerSecond: LASER.autoFireRate, mineUntilProduction: 0.1 }

type Item = { kind: 'reactor'; id: UpgradeId } | { kind: 'laser'; id: LaserUpgradeId }

const ITEMS: readonly Item[] = [
  ...UPGRADES.map((u) => ({ kind: 'reactor' as const, id: u.id })),
  ...LASER_UPGRADES.map((u) => ({ kind: 'laser' as const, id: u.id })),
]

export interface Purchase {
  /** Seconds since the start. */
  readonly time: number
  readonly id: UpgradeId | LaserUpgradeId
  /** Owned count or level after the purchase. */
  readonly owned: number
}

export interface Simulation {
  readonly purchases: readonly Purchase[]
  /** Seconds until the first unit of each upgrade was bought. */
  readonly firstPurchaseAt: Partial<Record<UpgradeId, number>>
  /** Seconds until production covers the fastest speed level, or null if not reached in time. */
  readonly maxWarpAt: number | null
  /** Income over time: production alone and including mining, sampled at every purchase. */
  readonly income: readonly { time: number; production: number; total: number }[]
  readonly state: GameState
}

function cost(state: GameState, item: Item): number {
  if (item.kind === 'reactor') {
    const upgrade = UPGRADES.find((u) => u.id === item.id)
    return upgrade ? upgradeCost(upgrade, state.owned[item.id]) : Number.POSITIVE_INFINITY
  }
  const upgrade = LASER_UPGRADES.find((u) => u.id === item.id)
  if (!upgrade || isLaserMaxed(state, item.id)) return Number.POSITIVE_INFINITY
  return laserCost(upgrade, state.lasers[item.id])
}

function withOneMore(state: GameState, item: Item): GameState {
  return item.kind === 'reactor'
    ? { ...state, owned: { ...state.owned, [item.id]: state.owned[item.id] + 1 } }
    : { ...state, lasers: { ...state.lasers, [item.id]: state.lasers[item.id] + 1 } }
}

function buy(state: GameState, item: Item): GameState {
  return item.kind === 'reactor' ? buyUpgrade(state, item.id) : buyLaser(state, item.id)
}

/**
 * Plays until production covers the fastest speed level or `maxSeconds` pass. Each step it
 * buys the upgrade that pays for itself soonest, counting the wait to afford it.
 */
export function simulate(style: Playstyle, maxSeconds: number): Simulation {
  let state = createInitialState()
  let time = 0
  const purchases: Purchase[] = []
  const firstPurchaseAt: Partial<Record<UpgradeId, number>> = {}
  const income: Simulation['income'][number][] = []

  while (time < maxSeconds) {
    const produced = production(state)
    const shots = produced < style.mineUntilProduction ? style.shotsPerSecond : 0
    const incomeOf = (s: GameState) => production(s) + shots * expectedHitEnergy(s)
    const current = incomeOf(state)
    const mining = current - produced
    income.push({ time, production: produced, total: current })
    if (produced >= MAX_DRAIN) {
      return { purchases, firstPurchaseAt, maxWarpAt: time, income, state }
    }

    let best: { item: Item; wait: number; score: number } | undefined
    for (const item of ITEMS) {
      const price = cost(state, item)
      const gain = incomeOf(withOneMore(state, item)) - current
      const wait = Math.max(0, (price - state.energy) / current)
      const score = wait + price / gain
      if (!best || score < best.score) best = { item, wait, score }
    }
    if (!best) break

    // A hair longer than needed, so floating-point rounding never leaves it just short.
    const wait = best.wait * (1 + 1e-9) + 1e-9
    const advanced = advance(state, wait).state
    state = { ...advanced, energy: advanced.energy + mining * wait }
    time += wait

    const bought = buy(state, best.item)
    if (bought === state) continue
    state = bought
    const { item } = best
    const owned = item.kind === 'reactor' ? state.owned[item.id] : state.lasers[item.id]
    purchases.push({ time, id: item.id, owned })
    if (item.kind === 'reactor') firstPurchaseAt[item.id] ??= time
  }

  return { purchases, firstPurchaseAt, maxWarpAt: null, income, state }
}

/** Longest wait between two purchases within the first `until` seconds. */
export function longestWait(purchases: readonly Purchase[], until: number): number {
  let longest = 0
  let previous = 0
  for (const { time } of purchases) {
    if (time > until) break
    longest = Math.max(longest, time - previous)
    previous = time
  }
  return longest
}
