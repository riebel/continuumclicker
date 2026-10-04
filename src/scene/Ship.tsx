import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  Box3,
  Group,
  type Material,
  type Mesh,
  MeshStandardMaterial,
  Object3D,
  type PointLight,
  Quaternion,
  Vector3,
} from 'three'
import arsenalUrl from '../assets/arsenal.glb?url'
import refitsUrl from '../assets/refits.glb?url'
import shipUrl from '../assets/ship.glb?url'
import { UPGRADES, WEAPONS, type WeaponId } from '../game/content'
import { shipForm, visualTier, warpIntensity } from '../game/engine'
import { gameStore, useGame } from '../game/store'
import { HEADING, layoutPosition, SHIP_LAYOUT, SHIP_ORIENTATION, stageBox } from './constants'
import { attachPlume, disposePlume, type NozzleKind, type Plume, updatePlume } from './plume'
import type { WeaponMuzzles } from './weaponMounts'

interface ModuleNode {
  readonly node: Object3D
  readonly module: string | undefined
  readonly form: number | undefined
  readonly weapon: string | undefined
  readonly tier: number
  readonly position: Vector3
  readonly scale: Vector3
  /** Centre of the module's geometry, the point it grows from when installed. */
  readonly pivot: Vector3
  /** performance.now() when it was installed, for the grow-in animation. */
  installedAt: number
}

interface PreparedShip {
  /** Marker at the tip of the bow, where the mining laser fires from. */
  readonly bow: Object3D
  readonly modules: ModuleNode[]
  readonly muzzles: Map<WeaponId, Object3D[]>
  readonly aims: { group: Group; weapon: WeaponId }[]
  readonly plumes: Plume[]
  readonly center: Vector3
  readonly radius: number
  readonly engineGlow: MeshStandardMaterial[]
  readonly reactor: MeshStandardMaterial[]
}

const REACTOR_GLOW = 4
const EMISSIVE_BASE: Record<string, number> = { Matrix: 2.2, Window: 2.4, Reactor: REACTOR_GLOW }
const INSTALL_MS = 900

function prepare(scene: Group): PreparedShip {
  scene.updateMatrixWorld(true)
  const aims: PreparedShip['aims'] = []
  const mounts = new Map<string, Group>()
  const assemblies: Object3D[] = []
  scene.traverse((node) => {
    if (typeof node.userData.weaponMount === 'string') {
      const group = new Group()
      node.getWorldPosition(group.position)
      mounts.set(node.userData.weaponMount, group)
      aims.push({ group, weapon: node.userData.weaponSystem as WeaponId })
    }
    if (node.userData.mount) assemblies.push(node)
  })
  for (const aim of aims) scene.add(aim.group)
  scene.updateMatrixWorld(true)
  for (const assembly of assemblies) mounts.get(assembly.userData.mount)?.attach(assembly)
  const bounds = new Box3().setFromObject(scene)
  const center = bounds.getCenter(new Vector3())
  const radius = bounds.getSize(new Vector3()).length() / 2

  const modules: ModuleNode[] = []
  const muzzles = new Map<WeaponId, Object3D[]>()
  const plumes: Plume[] = []
  const materials = new Set<MeshStandardMaterial>()

  scene.traverse((object) => {
    const data = object.userData as {
      module?: string
      tier?: number
      form?: number
      weapon?: string
      weaponTier?: number
      muzzle?: string
      nozzle?: NozzleKind
      radius?: number
    }
    if (data.muzzle) {
      const id = data.muzzle as WeaponId
      const outlets = muzzles.get(id) ?? []
      outlets.push(object)
      muzzles.set(id, outlets)
    }
    if ((data.module && data.tier) || data.form || data.weapon) {
      const pivot = new Box3().setFromObject(object).getCenter(new Vector3())
      object.parent?.worldToLocal(pivot)
      modules.push({
        node: object,
        module: data.module,
        tier: data.tier ?? data.weaponTier ?? 0,
        form: data.form,
        weapon: data.weapon,
        position: object.position.clone(),
        scale: object.scale.clone(),
        pivot,
        installedAt: 0,
      })
    }
    if (data.nozzle && data.radius) plumes.push(attachPlume(object, data.nozzle, data.radius))
    const mesh = object as Mesh
    if (mesh.isMesh) {
      for (const material of ([] as Material[]).concat(mesh.material)) {
        if (material instanceof MeshStandardMaterial) materials.add(material)
      }
    }
  })

  for (const material of materials) {
    const name = material.name
    const base = EMISSIVE_BASE[name]
    if (base !== undefined) material.emissiveIntensity = base
    if (name.startsWith('Weapon-')) material.emissiveIntensity = 1.8
    // Hull metals rely on the environment map for their sheen.
    if (!(name in EMISSIVE_BASE) && name !== 'EngineGlow') material.envMapIntensity = 1.2
  }

  // The model's forward axis is +X.
  const bow = new Object3D()
  bow.position.set(bounds.max.x, center.y, center.z)
  scene.add(bow)

  const byName = (name: string) => [...materials].filter((m) => m.name === name)
  return {
    bow,
    modules,
    muzzles,
    aims,
    plumes,
    center,
    radius,
    engineGlow: byName('EngineGlow'),
    reactor: byName('Reactor'),
  }
}

/** Shows every module tier the player has unlocked, e.g. "3,1,0,0,…" per upgrade. */
function useTiers(): Record<string, number> {
  const key = useGame((s) => UPGRADES.map((u) => visualTier(s.game.owned[u.id])).join(','))
  return useMemo(() => {
    const tiers = key.split(',').map(Number)
    return Object.fromEntries(UPGRADES.map((u, i) => [u.id, tiers[i] ?? 0]))
  }, [key])
}

const easeOutBack = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2

interface ShipProps {
  /** The HTML element (the stage button) the model is fitted into. */
  anchor: RefObject<HTMLElement | null>
  /** Receives the world position of the bow every frame. */
  bow: Vector3
  target?: Vector3
  collector?: Vector3
  muzzles?: WeaponMuzzles
  reducedMotion: boolean
}

export function Ship({ anchor, bow, target, collector, muzzles, reducedMotion }: ShipProps) {
  const { scene: template } = useGLTF(shipUrl, false, true)
  const { scene: refits } = useGLTF(refitsUrl, false, true)
  const { scene: arsenal } = useGLTF(arsenalUrl, false, true)
  // Keep the cached glTF untouched: remounts must not accumulate exhausts or bow markers.
  const { scene, ship } = useMemo(() => {
    const scene = new Group()
    const hullRefits = refits.clone(true)
    const legacy: Object3D[] = []
    hullRefits.traverse((node) => {
      if (node.userData.weapon || node.userData.weaponMount) legacy.push(node)
    })
    for (const node of legacy) node.removeFromParent()
    scene.add(template.clone(true), hullRefits, arsenal.clone(true))
    return { scene, ship: prepare(scene) }
  }, [template, refits, arsenal])
  const tiers = useTiers()
  const form = useGame((s) => shipForm(s.game))
  const weapons = useGame((s) => s.game.weapons)
  const root = useRef<Group>(null)
  const light = useRef<PointLight>(null)
  const throttle = useRef(0)
  const recoil = useRef({ shot: 0, kick: 0 })
  const mounted = useRef(false)
  const temp = useMemo(
    () => ({
      v: new Vector3(),
      sum: new Vector3(),
      pivot: new Vector3(),
      aim: new Quaternion(),
      neutral: new Quaternion(),
    }),
    [],
  )

  useEffect(() => () => ship.plumes.forEach(disposePlume), [ship])

  useLayoutEffect(() => {
    const now = performance.now()
    for (const m of ship.modules) {
      const visible = m.form
        ? m.form <= form
        : m.weapon
          ? m.tier <= (weapons[m.weapon as WeaponId] ?? 0)
          : m.tier <= (tiers[m.module ?? ''] ?? 0)
      if (visible && !m.node.visible) m.installedAt = mounted.current ? now : 0
      m.node.visible = visible
      if (!visible) {
        m.installedAt = 0
        m.node.position.copy(m.position)
        m.node.scale.copy(m.scale)
      }
    }
    mounted.current = true
  }, [ship, tiers, form, weapons])

  useFrame((state, delta) => {
    const group = root.current
    const element = anchor.current
    if (!group || !element) return
    const dt = Math.min(delta, 0.1)
    const time = state.clock.elapsedTime
    const latest = gameStore.getState().lastShot
    if (latest && latest.id !== recoil.current.shot) {
      recoil.current.shot = latest.id
      recoil.current.kick = latest.damage > 0 && !reducedMotion ? 1 : 0
    }
    recoil.current.kick *= Math.exp(-dt * 18)

    // Fit the ship into its spot in the anchor element's box.
    const box = stageBox(element.getBoundingClientRect(), state.size)
    const size = box.size * SHIP_LAYOUT.size
    layoutPosition(box, SHIP_LAYOUT, group.position)
    if (!reducedMotion) group.position.y += Math.sin(time * 0.6) * 0.015 * size
    group.scale.setScalar((size / (2 * ship.radius)) * 1.18)

    // Gentle drift and parallax towards the pointer.
    const sway = reducedMotion ? 0 : 1
    group.quaternion.copy(SHIP_ORIENTATION)
    group.rotateX(sway * Math.sin(time * 0.35) * 0.04)
    group.rotateY(state.pointer.x * 0.06 * sway)
    group.rotateZ(state.pointer.y * 0.04 * sway)

    // Engines follow the engaged speed level, spooling smoothly.
    const driveTarget = warpIntensity(gameStore.getState().game)
    throttle.current += (driveTarget - throttle.current) * Math.min(1, dt * 1.5)
    const drive = { throttle: throttle.current, time, dt }
    const glow = 2 + throttle.current * 7
    for (const material of ship.engineGlow) material.emissiveIntensity = glow
    for (const material of ship.reactor) {
      material.emissiveIntensity = REACTOR_GLOW * (0.8 + 0.25 * Math.sin(time * 2.4))
    }

    // Warm engine light at the centre of the visible main engines lights up the hull.
    temp.sum.set(0, 0, 0)
    let engines = 0
    for (const plume of ship.plumes) {
      updatePlume(plume, drive)
      if (plume.kind === 'rcs' || !isVisible(plume.nozzle)) continue
      temp.sum.add(plume.nozzle.getWorldPosition(temp.v))
      engines++
    }
    if (light.current && engines > 0) {
      light.current.position
        .copy(temp.sum.divideScalar(engines))
        .addScaledVector(HEADING, -0.5 * size)
      light.current.intensity = (0.6 + throttle.current * 2) * size * size
      light.current.distance = size * 2.5
    }

    // Newly installed modules grow into place from their own centre.
    const now = performance.now()
    for (const m of ship.modules) {
      if (m.weapon) m.node.position.copy(m.position)
      if (m.installedAt) {
        const t = reducedMotion ? 1 : Math.min(1, (now - m.installedAt) / INSTALL_MS)
        const k = Math.max(0.001, easeOutBack(t))
        temp.pivot.copy(m.pivot)
        m.node.position
          .copy(temp.pivot)
          .sub(temp.v.copy(temp.pivot).sub(m.position).multiplyScalar(k))
        m.node.scale.copy(m.scale).multiplyScalar(k)
        if (t >= 1) m.installedAt = 0
      }
      const firing =
        latest?.salvo?.some((shot) => shot.weapon === m.weapon) ?? latest?.weapon === m.weapon
      if (m.weapon && m.node.visible && m.node.userData.mount && firing)
        m.node.position.x -= recoil.current.kick * 0.14
    }
    group.updateMatrixWorld(true)
    if (target && target.lengthSq() > 0) {
      for (const { group: aim } of ship.aims) {
        scene.worldToLocal(temp.v.copy(target))
        temp.v.sub(aim.position).normalize()
        temp.aim.setFromUnitVectors(temp.pivot.set(1, 0, 0), temp.v)
        const angle = temp.aim.angleTo(temp.neutral)
        if (angle > 1.35) temp.aim.slerp(temp.neutral, 1 - 1.35 / angle)
        aim.quaternion.slerp(temp.aim, reducedMotion ? 1 : 1 - Math.exp(-dt * 14))
        aim.updateMatrixWorld(true)
      }
    }
    const emitter = ship.muzzles.get('pulse')?.[0] ?? ship.bow
    emitter.getWorldPosition(bow)
    if (muzzles)
      for (const weapon of WEAPONS) {
        const outlets = ship.muzzles.get(weapon.id) ?? []
        const positions = muzzles.get(weapon.id) ?? []
        positions.length = outlets.length
        for (const [i, outlet] of outlets.entries()) {
          positions[i] ??= new Vector3()
          outlet.getWorldPosition(positions[i] as Vector3)
        }
        muzzles.set(weapon.id, positions)
      }
    if (collector) collector.copy(scene.localToWorld(temp.v.set(-3.8, 1, 1.5)))
  })

  return (
    <>
      <group ref={root}>
        <primitive object={scene} position={ship.center.clone().negate()} />
      </group>
      <pointLight ref={light} color="#ffb45a" decay={2} />
    </>
  )
}

function isVisible(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false
  return true
}

useGLTF.preload(shipUrl, false, true)
useGLTF.preload(refitsUrl, false, true)
useGLTF.preload(arsenalUrl, false, true)
