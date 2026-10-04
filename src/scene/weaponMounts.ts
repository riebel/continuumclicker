import { Vector3 } from 'three'
import { WEAPONS, type WeaponId } from '../game/content'

/** World-space outlets of every installed hardpoint, updated by the Blender ship rig. */
export type WeaponMuzzles = Map<WeaponId, Vector3[]>

export function createWeaponMuzzles(): WeaponMuzzles {
  return new Map(WEAPONS.map((weapon) => [weapon.id, []]))
}

export interface WeaponTarget {
  readonly point: Vector3
  radius: number
}

/** Shared live tracks; retired entries remain valid for rounds already in flight. */
export class WeaponTargetCache {
  private readonly targets = new Map<number, WeaponTarget>()
  private readonly direction = new Vector3()

  get(id: number) {
    return this.targets.get(id)
  }

  update(
    rocks: readonly { ordinal: number }[],
    centers: readonly Vector3[],
    radii: readonly number[],
    bow: Vector3,
  ) {
    for (const [i, rock] of rocks.entries()) {
      const center = centers[i]
      if (!center) continue
      const target = this.targets.get(rock.ordinal) ?? { point: new Vector3(), radius: 1 }
      target.radius = radii[i] ?? 1
      this.direction.copy(bow).sub(center).normalize()
      target.point.copy(center).addScaledVector(this.direction, target.radius * 0.85)
      this.targets.set(rock.ordinal, target)
    }
    for (const id of this.targets.keys())
      if (!rocks.some((r) => r.ordinal === id)) this.targets.delete(id)
  }
}
