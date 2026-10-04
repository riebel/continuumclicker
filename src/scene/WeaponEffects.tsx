import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  type PointLight,
  Vector3,
} from 'three'
import projectilesUrl from '../assets/projectiles.glb?url'
import { WEAPONS, type WeaponId } from '../game/content'
import { gameStore } from '../game/store'
import { PROJECTILE_SECONDS } from './miningField'
import { attachPlume, disposePlume, type Plume, updatePlume } from './plume'
import type { WeaponMuzzles, WeaponTarget, WeaponTargetCache } from './weaponMounts'
import { beamGeometry, beamMaterial, flashGeometry, flashMaterial } from './weaponVisuals'

interface WeaponEffectsProps {
  bow: Vector3
  muzzles?: WeaponMuzzles | undefined
  target: Vector3
  targets: WeaponTargetCache
  chainTarget: Vector3
  asteroid: { center: Vector3; radius: number }
  reducedMotion: boolean
}
type FlightModels = Map<string, Object3D>

/** Blender flight models, physical nozzle exhausts, soft beam volumes and local flashes. */
export function WeaponEffects(props: WeaponEffectsProps) {
  const { scene } = useGLTF(projectilesUrl, false, true)
  const models = useMemo(() => {
    const found: FlightModels = new Map()
    scene.traverse((n) => {
      if (n.userData.projectile) found.set(n.userData.projectile, n)
      if (n instanceof Mesh)
        for (const material of [n.material].flat())
          if (material instanceof MeshStandardMaterial) material.envMapIntensity = 1.35
    })
    return found
  }, [scene])
  const light = useRef<PointLight>(null)
  const flash = useMemo(() => ({ id: 0, age: 10, center: new Vector3(), color: new Color() }), [])
  useFrame((_, delta) => {
    const shot = gameStore.getState().lastShot
    if (shot && shot.id !== flash.id) {
      flash.id = shot.id
      flash.age = 0
      flash.center.set(0, 0, 0)
      let count = 0
      for (const s of shot.salvo ?? [shot])
        for (const p of props.muzzles?.get(s.weapon) ?? [props.bow]) {
          flash.center.add(p)
          count++
        }
      flash.center.divideScalar(Math.max(1, count))
      flash.color.set(WEAPONS.find((w) => w.id === shot.weapon)?.color ?? '#ffffff')
    }
    flash.age += Math.min(delta, 0.1)
    if (light.current) {
      light.current.position.copy(flash.center)
      light.current.color.copy(flash.color)
      light.current.intensity = props.reducedMotion ? 0 : Math.exp(-flash.age * 42) * 12
    }
  })
  return (
    <>
      {WEAPONS.map((w) => (
        <MountedEffects key={w.id} {...props} weapon={w.id} color={w.color} models={models} />
      ))}
      <pointLight ref={light} decay={2} distance={5} intensity={0} />
    </>
  )
}

function flightModel(prototype: Object3D | undefined) {
  const root = new Group()
  const plumes: Plume[] = []
  if (prototype) {
    const model = prototype.clone(true)
    const outlets: Object3D[] = []
    model.traverse((n) => {
      if (n.userData.nozzle) outlets.push(n)
    })
    for (const n of outlets) plumes.push(attachPlume(n, 'nacelle', n.userData.radius))
    root.add(model)
  }
  return { root, plumes }
}

function MountedEffects({
  bow,
  muzzles,
  target,
  targets,
  chainTarget,
  asteroid,
  reducedMotion,
  weapon,
  color,
  models,
}: WeaponEffectsProps & { weapon: WeaponId; color: string; models: FlightModels }) {
  const assets = useMemo(() => {
    const group = new Group()
    const name =
      weapon === 'swarm'
        ? 'hydra_missile'
        : weapon === 'plasma'
          ? 'plasma_capsule'
          : weapon === 'railgun'
            ? 'rail_dart'
            : null
    const flights = name
      ? Array.from({ length: weapon === 'swarm' ? 7 : weapon === 'plasma' ? 2 : 1 }, () => {
          const flight = flightModel(models.get(name))
          const trail = new Mesh(beamGeometry, beamMaterial(color, true))
          group.add(flight.root, trail)
          flight.root.visible = trail.visible = false
          return { ...flight, trail }
        })
      : []
    const beams = ['pulse', 'cryo', 'singularity'].includes(weapon)
      ? Array.from({ length: 2 }, () => new Mesh(beamGeometry, beamMaterial(color)))
      : []
    const arcs =
      weapon === 'tesla'
        ? Array.from({ length: 30 }, () => new Mesh(beamGeometry, beamMaterial(color)))
        : []
    const flashes = Array.from(
      { length: weapon === 'swarm' ? 4 : 2 },
      () => new Mesh(flashGeometry, flashMaterial(color)),
    )
    const impact = new Mesh(flashGeometry, flashMaterial(color))
    const lens =
      weapon === 'singularity' ? new Mesh(flashGeometry, flashMaterial(color, true)) : null
    for (const mesh of [...beams, ...arcs, ...flashes, impact, ...(lens ? [lens] : [])]) {
      mesh.visible = false
      mesh.frustumCulled = false
      group.add(mesh)
    }
    return { group, flights, beams, arcs, flashes, impact, lens }
  }, [models, weapon, color])
  useEffect(
    () => () => {
      for (const flight of assets.flights) {
        flight.plumes.forEach(disposePlume)
        flight.trail.material.dispose()
      }
      for (const mesh of [
        ...assets.beams,
        ...assets.arcs,
        ...assets.flashes,
        assets.impact,
        ...(assets.lens ? [assets.lens] : []),
      ])
        mesh.material.dispose()
    },
    [assets],
  )
  const sim = useMemo(
    () => ({
      id: 0,
      age: 10,
      special: false,
      chained: false,
      count: 1,
      missiles: 3,
      radius: 1,
      track: null as WeaponTarget | null,
      chainTrack: null as WeaponTarget | null,
      origins: Array.from({ length: 4 }, () => new Vector3()),
      from: new Vector3(),
      to: new Vector3(),
      chainTo: new Vector3(),
      dir: new Vector3(),
      side: new Vector3(),
      up: new Vector3(),
      a: new Vector3(),
      b: new Vector3(),
      v: new Vector3(),
      axis: new Vector3(0, 1, 0),
      forward: new Vector3(1, 0, 0),
    }),
    [],
  )

  useFrame((state, delta) => {
    const { lastShot, game } = gameStore.getState()
    if (!lastShot) {
      sim.id = 0
      sim.age = 10
    } else if (lastShot.id !== sim.id) {
      sim.id = lastShot.id
      const shot = (lastShot.salvo ?? [lastShot]).find((s) => s.weapon === weapon)
      if (shot) {
        sim.age = 0
        sim.special = !!shot.special
        sim.chained = shot.chained > 0
        sim.missiles = 2 + game.weapons.swarm
        sim.track = targets.get(lastShot.targetId) ?? null
        sim.chainTrack = targets.get(lastShot.targetId + 1) ?? null
        sim.radius = sim.track?.radius ?? asteroid.radius
        sim.to.copy(sim.track?.point ?? target)
        sim.chainTo.copy(sim.chainTrack?.point ?? chainTarget)
        const outlets = muzzles?.get(weapon)
        sim.count = Math.min(4, outlets?.length || 1)
        for (let i = 0; i < sim.count; i++) sim.origins[i]?.copy(outlets?.[i] ?? bow)
        sim.from.copy(sim.origins[0] ?? bow)
      }
    }
    sim.age += Math.min(delta, 0.1)
    if (sim.age < 0.65 && sim.track) sim.to.copy(sim.track.point)
    if (sim.age < 0.24 && sim.chainTrack) sim.chainTo.copy(sim.chainTrack.point)
    sim.dir.copy(sim.to).sub(sim.from).normalize()
    sim.side.crossVectors(sim.dir, state.camera.up).normalize()
    sim.up.copy(state.camera.up)
    const projectiled = ['swarm', 'plasma'].includes(weapon)
    const duration = weapon === 'railgun' ? 0.095 : PROJECTILE_SECONDS
    const impactAge = sim.age - (projectiled ? duration : 0)
    const envelope = Math.max(0, 1 - sim.age / 0.15)
    const beam = (
      mesh: Mesh<typeof beamGeometry, ReturnType<typeof beamMaterial>>,
      from: Vector3,
      to: Vector3,
      width: number,
      opacity: number,
    ) => {
      sim.v.copy(to).sub(from)
      mesh.position.copy(from).addScaledVector(sim.v, 0.5)
      mesh.scale.set(width, sim.v.length(), width)
      mesh.quaternion.setFromUnitVectors(sim.axis, sim.v.normalize())
      mesh.material.uniforms.uOpacity.value = opacity
      mesh.material.uniforms.uTime.value = state.clock.elapsedTime
    }
    for (const [i, mesh] of assets.beams.entries()) {
      mesh.visible = i < sim.count && envelope > 0
      const from = muzzles?.get(weapon)?.[i] ?? sim.origins[i] ?? bow
      beam(
        mesh,
        from,
        sim.to,
        sim.radius * (weapon === 'cryo' ? 0.013 : weapon === 'singularity' ? 0.017 : 0.011),
        envelope,
      )
    }
    for (const [i, mesh] of assets.arcs.entries()) {
      const chain = i >= 20,
        index = i % 10
      mesh.visible = sim.age < 0.19 && !reducedMotion && (chain ? sim.chained : i < sim.count * 10)
      if (!mesh.visible) continue
      const from = chain
        ? sim.to
        : (muzzles?.get(weapon)?.[Math.floor(i / 10)] ?? sim.origins[Math.floor(i / 10)] ?? bow)
      const to = chain ? sim.chainTo : sim.to
      const jitter = (n: number) =>
        n === 0 || n === 10 ? 0 : Math.sin(n * 12.7 + sim.age * 100) * sim.radius * 0.13
      sim.a
        .copy(from)
        .lerp(to, index / 10)
        .addScaledVector(sim.side, jitter(index))
      sim.b
        .copy(from)
        .lerp(to, (index + 1) / 10)
        .addScaledVector(sim.side, jitter(index + 1))
      beam(mesh, sim.a, sim.b, sim.radius * 0.009, Math.max(0, 1 - sim.age / 0.19))
    }
    for (const [i, flight] of assets.flights.entries()) {
      const delay = weapon === 'swarm' ? (i % 3) * 0.025 : 0
      const raw = Math.max(0, Math.min(1, (sim.age - delay) / (duration - delay)))
      const visible =
        sim.age >= delay &&
        raw < 1 &&
        !reducedMotion &&
        (weapon !== 'swarm' || i < sim.missiles) &&
        (weapon !== 'plasma' || i < sim.count)
      flight.root.visible = flight.trail.visible = visible
      if (!visible) continue
      const t = raw ** 1.15
      const from = sim.origins[i % sim.count] ?? sim.from
      const spread = weapon === 'swarm' ? (i - (sim.missiles - 1) / 2) * sim.radius * 0.3 : 0
      const arc = weapon === 'swarm' ? sim.radius * 0.2 : 0
      flight.root.position
        .copy(from)
        .lerp(sim.to, t)
        .addScaledVector(sim.side, Math.sin(t * Math.PI) * spread)
        .addScaledVector(sim.up, Math.sin(t * Math.PI) * arc)
      const ahead = Math.min(1, t + 0.015)
      sim.b
        .copy(from)
        .lerp(sim.to, ahead)
        .addScaledVector(sim.side, Math.sin(ahead * Math.PI) * spread)
        .addScaledVector(sim.up, Math.sin(ahead * Math.PI) * arc)
      sim.dir.copy(sim.b).sub(flight.root.position).normalize()
      flight.root.quaternion.setFromUnitVectors(sim.forward, sim.dir)
      const scale =
        sim.radius *
        (weapon === 'swarm' ? 0.34 : weapon === 'plasma' ? (sim.special ? 0.42 : 0.28) : 0.22)
      flight.root.scale.setScalar(scale)
      flight.root.updateMatrixWorld(true)
      for (const plume of flight.plumes)
        updatePlume(plume, {
          throttle: weapon === 'swarm' ? 0.75 : 0.3,
          time: state.clock.elapsedTime,
          dt: delta,
        })
      const tail = sim.radius * (weapon === 'railgun' ? 1.5 : weapon === 'plasma' ? 0.7 : 0.45)
      sim.a.copy(flight.root.position).addScaledVector(sim.dir, -tail)
      sim.b.copy(flight.root.position).addScaledVector(sim.dir, -scale * 0.55)
      beam(
        flight.trail,
        sim.a,
        sim.b,
        sim.radius * (weapon === 'railgun' ? 0.008 : 0.014),
        weapon === 'swarm' ? 0.35 : 0.7,
      )
    }
    for (const [i, mesh] of assets.flashes.entries()) {
      mesh.visible = i < sim.count && sim.age < 0.16 && !reducedMotion
      mesh.position.copy(muzzles?.get(weapon)?.[i] ?? sim.origins[i] ?? bow)
      mesh.quaternion.copy(state.camera.quaternion)
      mesh.scale.setScalar(sim.radius * 0.48)
      mesh.material.uniforms.uAge.value = sim.age
    }
    assets.impact.visible =
      impactAge >= 0 && impactAge < 0.3 && !reducedMotion && weapon !== 'pulse'
    assets.impact.position.copy(sim.to)
    assets.impact.quaternion.copy(state.camera.quaternion)
    assets.impact.scale.setScalar(sim.radius * (sim.special ? 1.6 : 1.1))
    assets.impact.material.uniforms.uAge.value = impactAge
    if (assets.lens) {
      assets.lens.visible = sim.special && impactAge >= 0 && impactAge < 0.55 && !reducedMotion
      assets.lens.position.copy(sim.to)
      assets.lens.quaternion.copy(state.camera.quaternion)
      assets.lens.scale.setScalar(sim.radius * 3)
      assets.lens.material.uniforms.uAge.value = impactAge
    }
  })
  return <primitive object={assets.group} />
}

useGLTF.preload(projectilesUrl, false, true)
