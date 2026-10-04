import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { WeaponTargetCache } from './weaponMounts'

describe('individual projectile target tracks', () => {
  it('keeps simultaneous volleys attached to different moving rocks', () => {
    const tracks = new WeaponTargetCache()
    const centers = [new Vector3(5, 0, 0), new Vector3(0, 5, 0)]
    const rocks = [{ ordinal: 8 }, { ordinal: 9 }]
    const bow = new Vector3()
    tracks.update(rocks, centers, [1, 1], bow)
    const first = tracks.get(8)
    const second = tracks.get(9)
    centers[0]?.set(7, 0, 0)
    centers[1]?.set(0, 8, 0)
    tracks.update(rocks, centers, [1, 1], bow)
    expect(tracks.get(8)).toBe(first)
    expect(first?.point.toArray()).toEqual([6.15, 0, 0])
    expect(second?.point.toArray()).toEqual([0, 7.15, 0])
  })

  it('retains an impact point for already launched rounds after a rock is replaced', () => {
    const tracks = new WeaponTargetCache()
    const bow = new Vector3()
    tracks.update([{ ordinal: 3 }], [new Vector3(5, 0, 0)], [1], bow)
    const inFlight = tracks.get(3)
    tracks.update([{ ordinal: 8 }], [new Vector3(-5, 3, 0)], [2], bow)
    expect(tracks.get(3)).toBeUndefined()
    expect(inFlight?.point.toArray()).toEqual([4.15, 0, 0])
    expect(tracks.get(8)).not.toBe(inFlight)
    expect(tracks.get(8)?.radius).toBe(2)
  })
})
