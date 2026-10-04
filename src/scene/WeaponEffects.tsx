import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Color, type Group, type Mesh, type MeshBasicMaterial, Vector3 } from 'three'
import { WEAPONS, type WeaponId } from '../game/content'
import { gameStore } from '../game/store'

/** Projectile paths and impact shapes give each weapon a readable visual identity. */
export function WeaponEffects({
  bow,
  target,
  asteroid,
  reducedMotion,
}: {
  bow: Vector3
  target: Vector3
  asteroid: { center: Vector3; radius: number }
  reducedMotion: boolean
}) {
  const missiles = useRef<Group>(null)
  const bolts = useRef<Group>(null)
  const orb = useRef<Mesh>(null)
  const ring = useRef<Mesh>(null)
  const horizon = useRef<Mesh>(null)
  const frost = useRef<Mesh>(null)
  const sim = useMemo(
    () => ({
      id: 0,
      age: 10,
      weapon: 'pulse' as WeaponId,
      special: false,
      missileCount: 3,
      from: new Vector3(),
      to: new Vector3(),
      dir: new Vector3(),
      side: new Vector3(),
      a: new Vector3(),
      b: new Vector3(),
      v: new Vector3(),
      color: new Color(),
    }),
    [],
  )

  useFrame((state, delta) => {
    const { lastShot, game } = gameStore.getState()
    if (lastShot && lastShot.id !== sim.id) {
      sim.id = lastShot.id
      sim.age = 0
      sim.weapon = lastShot.weapon
      sim.special = !!lastShot.special
      sim.missileCount = 2 + game.weapons.swarm
      sim.from.copy(bow)
      sim.to.copy(target)
      sim.dir.copy(sim.to).sub(sim.from).normalize()
      sim.side.crossVectors(sim.dir, state.camera.up).normalize()
      sim.color.set(WEAPONS.find((w) => w.id === sim.weapon)?.color ?? '#ffffff').multiplyScalar(3)
    }
    sim.age += Math.min(delta, 0.1)
    const distance = sim.from.distanceTo(sim.to)
    const unit = distance * 0.12
    const t = Math.min(1, sim.age / 0.3)
    const alive = sim.age < 0.5 && !reducedMotion
    const colorize = (mesh: Mesh) => {
      const material = mesh.material as MeshBasicMaterial
      material.color.copy(sim.color)
    }

    if (missiles.current) {
      missiles.current.visible = alive && sim.weapon === 'swarm' && t < 1
      missiles.current.children.forEach((object, i) => {
        const missile = object as Mesh
        missile.visible = i < sim.missileCount
        const offset = (i - (sim.missileCount - 1) / 2) * Math.sin(t * Math.PI) * unit * 0.7
        missile.position.copy(sim.from).lerp(sim.to, t).addScaledVector(sim.side, offset)
        missile.quaternion.setFromUnitVectors(sim.v.set(0, 1, 0), sim.dir)
        missile.scale.set(unit * 0.06, unit * 0.28, unit * 0.06)
        colorize(missile)
      })
    }
    if (bolts.current) {
      bolts.current.visible = alive && sim.weapon === 'tesla' && sim.age < 0.22
      bolts.current.children.forEach((object, i) => {
        const mesh = object as Mesh
        const jitter = (index: number) =>
          index === 0 || index === 10 ? 0 : Math.sin(index * 12.7 + sim.age * 90) * unit * 0.5
        sim.a
          .copy(sim.from)
          .lerp(sim.to, i / 10)
          .addScaledVector(sim.side, jitter(i))
        sim.b
          .copy(sim.from)
          .lerp(sim.to, (i + 1) / 10)
          .addScaledVector(sim.side, jitter(i + 1))
        mesh.position.copy(sim.a).add(sim.b).multiplyScalar(0.5)
        sim.v.copy(sim.b).sub(sim.a)
        mesh.scale.set(unit * 0.025, sim.v.length(), unit * 0.025)
        mesh.quaternion.setFromUnitVectors(sim.a.set(0, 1, 0), sim.v.normalize())
        colorize(mesh)
      })
    }
    if (orb.current) {
      orb.current.visible = alive && sim.weapon === 'plasma' && t < 1
      orb.current.position.copy(sim.from).lerp(sim.to, t)
      orb.current.scale.setScalar(unit * (sim.special ? 0.38 : 0.14))
      colorize(orb.current)
    }
    if (ring.current) {
      ring.current.visible = alive && sim.weapon !== 'pulse' && sim.age > 0.08
      ring.current.position.copy(sim.to)
      ring.current.quaternion.copy(state.camera.quaternion)
      const collapse = sim.weapon === 'singularity'
      ring.current.scale.setScalar(
        unit * (collapse ? 2.5 * (1 - sim.age / 0.5) : 0.3 + sim.age * (sim.special ? 5 : 3)),
      )
      const material = ring.current.material as MeshBasicMaterial
      material.opacity = Math.max(0, 1 - sim.age / 0.5)
      colorize(ring.current)
    }
    if (horizon.current) {
      horizon.current.visible = alive && sim.weapon === 'singularity' && sim.special
      horizon.current.position.copy(sim.to)
      horizon.current.scale.setScalar(unit * Math.sin((sim.age / 0.5) * Math.PI) * 1.2)
    }
    if (frost.current) {
      frost.current.visible = game.frozen
      frost.current.position.copy(asteroid.center)
      frost.current.scale.setScalar(asteroid.radius * 1.06)
    }
  })

  return (
    <>
      <group ref={missiles} visible={false}>
        {Array.from({ length: 7 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed projectile pool
          <mesh key={`missile-${i}`}>
            <coneGeometry args={[1, 1, 5]} />
            <meshBasicMaterial toneMapped={false} />
          </mesh>
        ))}
      </group>
      <group ref={bolts} visible={false}>
        {Array.from({ length: 10 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed lightning segments
          <mesh key={`arc-${i}`}>
            <cylinderGeometry args={[1, 1, 1, 5]} />
            <meshBasicMaterial toneMapped={false} />
          </mesh>
        ))}
      </group>
      <mesh ref={orb} visible={false}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial toneMapped={false} />
      </mesh>
      <mesh ref={ring} visible={false}>
        <torusGeometry args={[1, 0.04, 6, 48]} />
        <meshBasicMaterial transparent opacity={0} toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh ref={horizon} visible={false}>
        <sphereGeometry args={[1, 24, 16]} />
        <meshBasicMaterial color="#03020b" />
      </mesh>
      <mesh ref={frost} visible={false}>
        <icosahedronGeometry args={[1, 1]} />
        <meshBasicMaterial
          color={[0.3, 2, 3]}
          wireframe
          transparent
          opacity={0.5}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
    </>
  )
}
