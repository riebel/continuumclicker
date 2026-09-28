import { MAX_DRAIN, UPGRADES, type UpgradeId } from './content'
import {
  advance,
  buyUpgrade,
  createInitialState,
  expectedClickEnergy,
  type GameState,
  production,
  upgradeCost,
} from './engine'

/**
 * A bot that plays the economy, used to check the pacing of the game (see balance.test.ts).
 * It never flies, so all energy goes into upgrades: the fastest possible progression.
 */
export interface Playstyle {
  /** Clicks per second while the player is clicking. */
  readonly clicksPerSecond: number
  /** Stop clicking once production reaches this many energy per second. */
  readonly clickUntilProduction: number
}

export const ACTIVE: Playstyle = {
  clicksPerSecond: 4,
  clickUntilProduction: Number.POSITIVE_INFINITY,
}
/** Clicks only to afford the first reactor, then leaves the game running. */
export const IDLE: Playstyle = { clicksPerSecond: 4, clickUntilProduction: 0.1 }

export interface Purchase {
  /** Seconds since the start. */
  readonly time: number
  readonly id: UpgradeId
  /** Owned count after the purchase. */
  readonly owned: number
}

export interface Simulation {
  readonly purchases: readonly Purchase[]
  /** Seconds until the first unit of each upgrade was bought. */
  readonly firstPurchaseAt: Partial<Record<UpgradeId, number>>
  /** Seconds until production covers the fastest speed level, or null if not reached in time. */
  readonly maxWarpAt: number | null
  readonly state: GameState
}

function withOneMore(state: GameState, id: UpgradeId): GameState {
  return { ...state, owned: { ...state.owned, [id]: state.owned[id] + 1 } }
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

  while (time < maxSeconds) {
    const produced = production(state)
    if (produced >= MAX_DRAIN) {
      return { purchases, firstPurchaseAt, maxWarpAt: time, state }
    }
    const clicking = produced < style.clickUntilProduction ? style.clicksPerSecond : 0
    const clickIncome = clicking * expectedClickEnergy(state)
    const income = produced + clickIncome

    let best: { id: UpgradeId; wait: number; score: number } | undefined
    for (const upgrade of UPGRADES) {
      const cost = upgradeCost(upgrade, state.owned[upgrade.id])
      const gain = production(withOneMore(state, upgrade.id)) - produced
      const wait = Math.max(0, (cost - state.energy) / income)
      const score = wait + cost / gain
      if (!best || score < best.score) best = { id: upgrade.id, wait, score }
    }
    if (!best) break

    // A hair longer than needed, so floating-point rounding never leaves it just short.
    const wait = best.wait * (1 + 1e-9) + 1e-9
    const advanced = advance(state, wait).state
    state = { ...advanced, energy: advanced.energy + clickIncome * wait }
    time += wait

    const bought = buyUpgrade(state, best.id)
    if (bought === state) continue
    state = bought
    const owned = state.owned[best.id]
    purchases.push({ time, id: best.id, owned })
    firstPurchaseAt[best.id] ??= time
  }

  return { purchases, firstPurchaseAt, maxWarpAt: null, state }
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
