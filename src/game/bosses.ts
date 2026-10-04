import { LASER, WEAPON_SYSTEMS, WEAPONS, type WeaponId } from './content'
import {
  createWeaponCharges,
  critChance,
  expectedSalvoEnergy,
  type GameState,
  production,
  type Shot,
  shipForm,
  type WeaponCharges,
} from './engine'
import { mulberry32 } from './random'

export const BOSS_RULES = {
  firstAfter: 150,
  interval: 330,
  warningSeconds: 9,
  resultSeconds: 5,
  combatLimit: 100,
  minimumMined: 12,
  rewardProductionSeconds: 90,
  rewardMiningSeconds: 40,
} as const

export const BOSS_TYPES = {
  leviathan: {
    name: 'Nacre Leviathan',
    class: 'Abyssal organism',
    signal: 'Something is moving inside the rift.',
    attack: 'Gravitic scream',
    color: '#e998b5',
    health: 1,
    attackSeconds: 8,
  },
  dreadnought: {
    name: 'Obsidian Dreadnought',
    class: 'Hostile siege vessel',
    signal: 'Capital-class drive signature. Weapons charging.',
    attack: 'Siege battery',
    color: '#ff996d',
    health: 1.12,
    attackSeconds: 8.5,
  },
} as const

export type BossId = keyof typeof BOSS_TYPES
export interface BossEncounter {
  readonly id: number
  readonly kind: BossId
  readonly rank: number
  readonly stage: 'warning' | 'combat' | 'victory' | 'escaped'
  readonly age: number
  readonly combatAge: number
  readonly hp: number
  readonly maxHp: number
  readonly shield: number
  readonly attackIn: number
  readonly attacks: number
  readonly interrupted: number
  readonly stagger: number
  readonly chilled: number
  readonly reward: number
  readonly lastDamage: number
  readonly lastCritical: boolean
  readonly finisher: WeaponId | null
}

export function bossPhase(boss: BossEncounter): number {
  const health = boss.hp / boss.maxHp
  return health <= 0.32 ? 3 : health <= 0.68 ? 2 : 1
}

export function bossExposed(boss: BossEncounter): boolean {
  return boss.stage === 'combat' && (boss.attackIn <= 2.3 || boss.chilled > 0)
}

/** Threat is fixed at interception; purchasing equipment never increases an existing boss's HP. */
export function createBoss(game: GameState, id: number, kind: BossId): BossEncounter {
  const rank = Math.max(1, shipForm(game))
  const health = [150, 230, 440, 1_050, 1_500, 2_200, 3_000][rank] ?? 3_000
  const maxHp = Math.round(health * BOSS_TYPES[kind].health)
  const reward = Math.max(
    150,
    production(game) * BOSS_RULES.rewardProductionSeconds +
      expectedSalvoEnergy(game) * LASER.autoFireRate * BOSS_RULES.rewardMiningSeconds,
  )
  return {
    id,
    kind,
    rank,
    stage: 'warning',
    age: 0,
    combatAge: 0,
    hp: maxHp,
    maxHp,
    shield: 100,
    attackIn: BOSS_TYPES[kind].attackSeconds,
    attacks: 0,
    interrupted: 0,
    stagger: 0,
    chilled: 0,
    reward,
    lastDamage: 0,
    lastCritical: false,
    finisher: null,
  }
}

export function retreatBoss(boss: BossEncounter): BossEncounter {
  return { ...boss, stage: 'escaped', age: 0 }
}

/** Only foreground time enters this function. Step boundaries cannot skip telegraphed attacks. */
export function advanceBoss(boss: BossEncounter, seconds: number): BossEncounter | null {
  if (seconds <= 0) return boss
  if (boss.stage === 'victory' || boss.stage === 'escaped') {
    const age = boss.age + seconds
    return age >= BOSS_RULES.resultSeconds ? null : { ...boss, age }
  }
  if (boss.stage === 'warning') {
    const age = boss.age + seconds
    if (age < BOSS_RULES.warningSeconds) return { ...boss, age }
    return advanceBoss({ ...boss, stage: 'combat', age: 0 }, age - BOSS_RULES.warningSeconds)
  }
  let current = boss
  let remaining = seconds
  while (remaining > 1e-9) {
    const slowed = current.chilled > 0
    const speed = slowed ? 0.55 : 1
    const step = Math.min(
      remaining,
      current.attackIn / speed,
      slowed ? current.chilled : Number.POSITIVE_INFINITY,
      BOSS_RULES.combatLimit - current.combatAge,
    )
    current = {
      ...current,
      age: current.age + step,
      combatAge: current.combatAge + step,
      chilled: Math.max(0, current.chilled - step),
      attackIn: Math.max(0, current.attackIn - step * speed),
    }
    remaining -= step
    if (current.combatAge >= BOSS_RULES.combatLimit - 1e-9) return retreatBoss(current)
    if (current.attackIn <= 1e-9) {
      const phase = bossPhase(current)
      const shield = Math.max(0, current.shield - (10 + phase * 3))
      current = {
        ...current,
        shield,
        attacks: current.attacks + 1,
        stagger: 0,
        attackIn: BOSS_TYPES[current.kind].attackSeconds - (phase - 1) * 0.65,
      }
      if (shield === 0) return retreatBoss(current)
    }
  }
  return current
}

/** Complementary weapon roles, using the same independent hardpoint cadence as mining. */
function weaponDamage(id: WeaponId, level: number, charge: number, boss: BossEncounter) {
  switch (id) {
    case 'plasma':
      return charge % 3 === 0 ? 3 + level : 1
    case 'railgun':
      return (1 + level) * (boss.kind === 'dreadnought' ? 1.3 : 1)
    case 'tesla':
      return 1 + level * 0.5
    case 'cryo':
      return boss.chilled > 0 ? 2 + level : 1
    case 'swarm':
      return 2 + level
    case 'singularity':
      // Bosses resist instant collapse. The fourth discharge is a bounded armour-breaking hit.
      return charge % 4 === 0 ? 6 + 2 * level : 1
    default:
      return 1
  }
}

export function fireAtBoss(
  game: GameState,
  boss: BossEncounter,
  charges: WeaponCharges,
  random: () => number = Math.random,
): { game: GameState; boss: BossEncounter; charges: WeaponCharges; shot: Shot } {
  if (boss.stage !== 'combat')
    return {
      game,
      boss,
      charges,
      shot: {
        weapon: 'pulse',
        special: null,
        damage: 0,
        chained: 0,
        gained: 0,
        critical: false,
        bonus: 0,
        target: { kind: 'rock', hp: boss.hp, maxHp: boss.maxHp },
      },
    }
  const nextCharges = { ...charges }
  const salvo: Shot[] = []
  let hp = boss.hp
  let chilled = boss.chilled
  let stagger = boss.attackIn <= 2.3 ? boss.stagger : 0
  const exposed = bossExposed(boss)
  const power = 1 + shipForm(game) * 0.045 + game.lasers['laser-amplifier'] * 0.04
  for (const weapon of WEAPONS) {
    const level = game.weapons[weapon.id]
    const system = WEAPON_SYSTEMS[weapon.id]
    if (!level || game.clicks % system.cadence !== system.phase) continue
    const charge = (nextCharges[weapon.id] ?? 0) + 1
    nextCharges[weapon.id] = charge % 12
    const critical = random() < Math.min(0.4, critChance(game) + (weapon.id === 'swarm' ? 0.1 : 0))
    const base = weaponDamage(weapon.id, level, charge, { ...boss, chilled })
    const weakpoint = exposed ? 1.65 : weapon.id === 'railgun' ? 1 : 0.85
    const damage = Math.min(hp, base * power * weakpoint * (critical ? 1.75 : 1))
    hp = Math.max(0, hp - damage)
    stagger += damage * (weapon.id === 'tesla' ? 2.5 : 1)
    let special: string | null = null
    if (weapon.id === 'cryo') {
      special = chilled > 0 ? 'Ice shatter' : 'Target chilled'
      chilled = chilled > 0 ? 0 : 3.5
    } else if (weapon.id === 'plasma' && charge % 3 === 0) special = 'Plasma detonation'
    else if (weapon.id === 'singularity' && charge % 4 === 0) special = 'Armour rupture'
    else if (exposed && damage > 0) special = 'Weak point hit'
    salvo.push({
      weapon: weapon.id,
      special,
      damage,
      chained: 0,
      gained: 0,
      bonus: 0,
      critical,
      target: { kind: 'rock', hp, maxHp: boss.maxHp },
    })
  }
  const damage = boss.hp - hp
  const critical = salvo.some((s) => s.critical)
  const interrupted = boss.attackIn <= 2.3 && stagger >= boss.maxHp * 0.065
  const won = hp <= 0
  const reward = won ? boss.reward : 0
  const leading = salvo.findLast((s) => s.damage > 0)
  const next: BossEncounter = {
    ...boss,
    hp,
    chilled,
    stagger: interrupted ? 0 : stagger,
    interrupted: boss.interrupted + (interrupted ? 1 : 0),
    shield: interrupted ? Math.min(100, boss.shield + 5) : boss.shield,
    attackIn: interrupted ? BOSS_TYPES[boss.kind].attackSeconds : boss.attackIn,
    stage: won ? 'victory' : boss.stage,
    age: won ? 0 : boss.age,
    lastDamage: damage,
    lastCritical: critical,
    finisher: won ? (leading?.weapon ?? 'pulse') : boss.finisher,
  }
  const shot: Shot = {
    weapon: leading?.weapon ?? 'pulse',
    salvo,
    damage,
    critical,
    gained: 0,
    bonus: reward,
    chained: 0,
    special: won
      ? 'Bounty secured'
      : interrupted
        ? 'Attack interrupted'
        : (leading?.special ?? null),
    target: { kind: 'rock', hp, maxHp: boss.maxHp },
  }
  return {
    boss: next,
    charges: nextCharges,
    shot,
    game: {
      ...game,
      clicks: game.clicks + 1,
      energy: game.energy + reward,
      lifetimeEnergy: game.lifetimeEnergy + reward,
      bossesDefeated: game.bossesDefeated + (won ? 1 : 0),
    },
  }
}

const fightEstimates = new Map<string, { won: boolean; seconds: number }>()

/** Optional hunting income, using actual combat/defence rules and the mining time it costs. */
export function expectedBossIncome(game: GameState): number {
  const mining = expectedSalvoEnergy(game) * LASER.autoFireRate
  let net = 0
  for (const kind of Object.keys(BOSS_TYPES) as BossId[]) {
    const key = [
      kind,
      shipForm(game),
      game.lasers['laser-amplifier'],
      game.lasers['precision-scanner'],
      ...WEAPONS.map((w) => game.weapons[w.id]),
    ].join(':')
    let estimate = fightEstimates.get(key)
    if (!estimate) {
      let boss = { ...createBoss(game, 1, kind), stage: 'combat' as const } as BossEncounter
      let model = game
      let charges = createWeaponCharges()
      let seconds = 0
      const random = mulberry32(1701)
      while (boss.stage === 'combat' && seconds < BOSS_RULES.combatLimit) {
        const fired = fireAtBoss(model, boss, charges, random)
        model = fired.game
        charges = fired.charges
        boss = advanceBoss(fired.boss, 1 / LASER.autoFireRate) ?? fired.boss
        seconds += 1 / LASER.autoFireRate
      }
      estimate = { won: boss.stage === 'victory', seconds }
      if (fightEstimates.size > 512) fightEstimates.clear()
      fightEstimates.set(key, estimate)
    }
    if (!estimate.won) continue
    const reward = Math.max(
      150,
      production(game) * BOSS_RULES.rewardProductionSeconds +
        mining * BOSS_RULES.rewardMiningSeconds,
    )
    net +=
      Math.max(0, reward - mining * estimate.seconds) /
      (BOSS_RULES.interval +
        BOSS_RULES.warningSeconds +
        BOSS_RULES.resultSeconds +
        estimate.seconds)
  }
  return net / 2
}
