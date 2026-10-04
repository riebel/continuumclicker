import type { Asteroid, AsteroidKind } from '../game/engine'

export const PROJECTILE_SECONDS = 0.24

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

  constructor(ordinal: number, kind: AsteroidKind) {
    this.ordinal = ordinal
    this.rocks = Array.from({ length: FIELD_SLOTS.length }, () => ({
      ordinal: 0,
      kind: 'rock' as AsteroidKind,
      enteredAt: -1,
      flash: 0,
      damage: 0,
      shake: 0,
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
    for (let ahead = 0; ahead < this.rocks.length; ahead++) {
      const id = ordinal + ahead
      Object.assign(this.rocks[this.slot(id)] as FieldRock, {
        ordinal: id,
        kind: ahead === 0 ? kind : 'rock',
        enteredAt: -1,
        flash: 0,
        damage: 0,
        shake: 0,
      })
    }
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
    this.ordinal = shot.nextOrdinal
    this.target.kind = shot.next.kind
    this.target.damage = 1 - shot.next.hp / shot.next.maxHp
  }
}
