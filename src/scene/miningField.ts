import type { Asteroid, AsteroidKind } from '../game/engine'

export const PROJECTILE_SECONDS = 0.24
export const TARGET_PASS_PHASE = 0.58

/** Belt flow is deliberately readable even at the highest drive setting (one lap >= 13s). */
export function beltRate(intensity: number): number {
  return intensity <= 0 ? 0 : 0.012 + 0.064 * Math.sqrt(Math.min(1, intensity))
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Visibility softens the far arrival and the exit, never the active firing window. */
export function beltVisibility(phase: number): number {
  return smoothstep(0, 0.08, phase) * (1 - smoothstep(0.84, 1, phase))
}

/** Screen composition in stage widths; depth keeps the belt well beyond the bow. */
export const FIELD_SLOTS = [
  { x: 0.1, y: 0.36, depth: -0.65, size: 0.064 },
  { x: 0.4, y: 0.31, depth: -0.85, size: 0.059 },
  { x: 0.26, y: 0.41, depth: -1.05, size: 0.052 },
  { x: -0.14, y: 0.4, depth: -1.2, size: 0.05 },
  { x: 0.43, y: 0.13, depth: -0.7, size: 0.058 },
] as const

export interface FieldRock {
  ordinal: number
  kind: AsteroidKind
  enteredAt: number
  flash: number
  damage: number
  shake: number
  phase: number
  /** Model identity survives a pass, but changes after destruction. */
  model: number
  /** Physical flight lane stays with the mesh when acquisition order changes. */
  lane: number
}

export interface FieldShot {
  /** The target before the engine applies the shot, including queued rapid-fire shots. */
  ordinal: number
  target: Asteroid
  next: Asteroid
  nextOrdinal: number
}

/** A rolling set of real targets. The next target already exists; only the consumed slot refills. */
export class MiningField {
  ordinal: number
  readonly rocks: FieldRock[]
  speed = 0

  constructor(ordinal: number, kind: AsteroidKind) {
    this.ordinal = ordinal
    this.rocks = Array.from({ length: FIELD_SLOTS.length }, () => ({
      ordinal: 0,
      kind: 'rock' as AsteroidKind,
      enteredAt: -1,
      flash: 0,
      damage: 0,
      shake: 0,
      phase: 0,
      model: 0,
      lane: 0,
    }))
    this.reset(ordinal, kind)
  }

  slot(ordinal = this.ordinal): number {
    return ordinal % this.rocks.length
  }

  get target(): FieldRock {
    return this.rocks[this.slot()] as FieldRock
  }

  reset(ordinal: number, kind: AsteroidKind): void {
    this.ordinal = ordinal
    this.speed = 0
    for (let ahead = 0; ahead < this.rocks.length; ahead++) {
      const id = ordinal + ahead
      Object.assign(this.rocks[this.slot(id)] as FieldRock, {
        ordinal: id,
        kind: ahead === 0 ? kind : 'rock',
        enteredAt: -1,
        flash: 0,
        damage: 0,
        shake: 0,
        phase: (0.32 - ahead / this.rocks.length + 1) % 1,
        model: id,
        lane: this.slot(id),
      })
    }
  }

  /** Prefer an approaching rock with >= 2.6 seconds left to mine at maximum drive. */
  prepareNext(): number | null {
    const next = this.slot(this.ordinal + 1)
    let selected = next
    let score = Number.NEGATIVE_INFINITY
    for (const [i, rock] of this.rocks.entries()) {
      if (i === this.slot()) continue
      const candidate = rock.phase <= 0.38 ? 2 + rock.phase : -rock.phase
      if (candidate > score) {
        score = candidate
        selected = i
      }
    }
    if (selected === next) return null
    const a = this.rocks[next] as FieldRock
    const b = this.rocks[selected] as FieldRock
    const ordinal = a.ordinal
    a.ordinal = b.ordinal
    b.ordinal = ordinal
    this.rocks[next] = b
    this.rocks[selected] = a
    return selected
  }

  advance(dt: number, intensity: number, reducedMotion: boolean, pending: boolean): boolean {
    if (reducedMotion) return false
    this.speed += (beltRate(intensity) - this.speed) * (1 - Math.exp(-1.6 * dt))
    for (const rock of this.rocks) {
      // Ice stops the rock's tumble; it still passes the ship with the rest of the belt.
      // In-flight rounds retain their target until impact, even at the end of its firing window.
      const active = rock === this.target
      rock.phase += this.speed * dt
      if (active && pending) rock.phase = Math.min(rock.phase, TARGET_PASS_PHASE)
      if (!active && rock.phase >= 1) rock.phase %= 1
    }
    return this.target.phase >= TARGET_PASS_PHASE && !pending
  }

  pass(nextOrdinal: number, next: Asteroid): void {
    const departing = this.target
    departing.ordinal = this.ordinal + this.rocks.length
    this.ordinal = nextOrdinal
    this.target.kind = next.kind
    this.target.damage = 1 - next.hp / next.maxHp
  }

  apply(shot: FieldShot, now: number): void {
    if (this.ordinal !== shot.ordinal) this.reset(shot.ordinal, shot.target.kind)
    const struck = this.target
    struck.damage = 1 - shot.target.hp / shot.target.maxHp
    struck.flash = 1
    struck.shake = Math.min(2, struck.shake + 0.7)
    if (shot.target.hp > 0) return
    // The replacement is a new distant arrival. Acquisition moves to an existing neighbour.
    struck.ordinal = shot.ordinal + this.rocks.length
    struck.kind = 'rock'
    struck.enteredAt = now
    struck.damage = struck.flash = struck.shake = 0
    struck.phase = 0.03
    struck.model = struck.ordinal
    this.ordinal = shot.nextOrdinal
    this.target.kind = shot.next.kind
    this.target.damage = 1 - shot.next.hp / shot.next.maxHp
  }
}
