import { Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import { attachPlume, updatePlume } from './plume'

const drive = { throttle: 0, time: 1, dt: 1 / 60 }
const length = (plume: ReturnType<typeof attachPlume>) =>
  plume.outer.material.uniforms.uLength?.value as number

describe('exhaust plumes', () => {
  it('hang off the nozzle marker, sized in nozzle radii', () => {
    const nozzle = new Object3D()
    const plume = attachPlume(nozzle, 'main', 0.8)
    expect(nozzle.children[0]?.scale.x).toBeCloseTo(0.8)
    expect(plume.core.parent).toBe(plume.outer.parent)
  })

  it('grow longer and brighter with throttle', () => {
    const plume = attachPlume(new Object3D(), 'main', 1)
    updatePlume(plume, drive)
    const idle = length(plume)
    const idleIntensity = plume.core.material.uniforms.uIntensity?.value as number
    updatePlume(plume, { ...drive, throttle: 1 })
    expect(length(plume)).toBeGreaterThan(idle * 3)
    expect(plume.core.material.uniforms.uIntensity?.value).toBeGreaterThan(idleIntensity)
    expect(plume.outer.visible).toBe(true)
  })

  it('fire manoeuvring jets only in short pulses', () => {
    const plume = attachPlume(new Object3D(), 'rcs', 0.1)
    plume.pulse = 0
    updatePlume(plume, { ...drive, dt: 0 })
    expect(plume.outer.visible).toBe(false)
    plume.pulse = 1
    updatePlume(plume, { ...drive, dt: 0 })
    expect(plume.outer.visible).toBe(true)
  })
})
