import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  Box3,
  type Group,
  type Material,
  type Mesh,
  MeshStandardMaterial,
  type Object3D,
  type PointLight,
  Vector3,
} from 'three'
import shipUrl from '../assets/ship.glb?url'
import { UPGRADES } from '../game/content'
import { visualTier, warpIntensity } from '../game/engine'
import { gameStore, useGame } from '../game/store'
import { CAMERA_DISTANCE, CAMERA_FOV, HEADING, SHIP_ORIENTATION } from './constants'
import { attachPlume, disposePlume, type NozzleKind, type Plume, updatePlume } from './plume'

interface ModuleNode {
  readonly node: Object3D
  readonly module: string
  readonly tier: number
  readonly position: Vector3
  readonly scale: Vector3
  /** Centre of the module's geometry, the point it grows from when installed. */
  readonly pivot: Vector3
  /** performance.now() when it was installed, for the grow-in animation. */
  installedAt: number
}

interface PreparedShip {
  readonly modules: ModuleNode[]
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
  const bounds = new Box3().setFromObject(scene)
  const center = bounds.getCenter(new Vector3())
  const radius = bounds.getSize(new Vector3()).length() / 2

  const modules: ModuleNode[] = []
  const plumes: Plume[] = []
  const materials = new Map<string, MeshStandardMaterial>()

  scene.traverse((object) => {
    const data = object.userData as {
      module?: string
      tier?: number
      nozzle?: NozzleKind
      radius?: number
    }
    if (data.module && data.tier) {
      modules.push({
        node: object,
        module: data.module,
        tier: data.tier,
        position: object.position.clone(),
        scale: object.scale.clone(),
        pivot: new Box3().setFromObject(object).getCenter(new Vector3()),
        installedAt: 0,
      })
    }
    if (data.nozzle && data.radius) plumes.push(attachPlume(object, data.nozzle, data.radius))
    const mesh = object as Mesh
    if (mesh.isMesh) {
      for (const material of ([] as Material[]).concat(mesh.material)) {
        if (material instanceof MeshStandardMaterial) materials.set(material.name, material)
      }
    }
  })

  for (const [name, material] of materials) {
    const base = EMISSIVE_BASE[name]
    if (base !== undefined) material.emissiveIntensity = base
    // Hull metals rely on the environment map for their sheen.
    if (!(name in EMISSIVE_BASE) && name !== 'EngineGlow') material.envMapIntensity = 1.2
  }

  const byName = (name: string) => [...materials.values()].filter((m) => m.name === name)
  return {
    modules,
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
  /** The HTML element (the clickable ship button) the model is fitted into. */
  anchor: RefObject<HTMLElement | null>
  reducedMotion: boolean
}

export function Ship({ anchor, reducedMotion }: ShipProps) {
  const { scene } = useGLTF(shipUrl, false, true)
  const ship = useMemo(() => prepare(scene), [scene])
  const tiers = useTiers()
  const root = useRef<Group>(null)
  const light = useRef<PointLight>(null)
  const boost = useRef(0)
  const throttle = useRef(0)
  const mounted = useRef(false)
  const temp = useMemo(() => ({ v: new Vector3(), sum: new Vector3(), pivot: new Vector3() }), [])

  useEffect(() => () => ship.plumes.forEach(disposePlume), [ship])

  // Clicking fires the engines harder for a moment.
  useEffect(
    () =>
      gameStore.subscribe((state, previous) => {
        if (state.game.clicks > previous.game.clicks)
          boost.current = Math.min(1.5, boost.current + 0.6)
      }),
    [],
  )

  useLayoutEffect(() => {
    const now = performance.now()
    for (const m of ship.modules) {
      const visible = m.tier <= (tiers[m.module] ?? 0)
      if (visible && !m.node.visible) m.installedAt = mounted.current ? now : 0
      m.node.visible = visible
    }
    mounted.current = true
  }, [ship, tiers])

  useFrame((state, delta) => {
    const group = root.current
    const element = anchor.current
    if (!group || !element) return
    const dt = Math.min(delta, 0.1)
    const time = state.clock.elapsedTime

    // Fit the ship into the anchor element's box.
    const rect = element.getBoundingClientRect()
    const { width, height } = state.size
    const visibleHeight = 2 * CAMERA_DISTANCE * Math.tan((CAMERA_FOV * Math.PI) / 360)
    const visibleWidth = (visibleHeight * width) / height
    const size = (Math.min(rect.width, rect.height) / height) * visibleHeight
    const scale = (size / (2 * ship.radius)) * 1.2
    boost.current = Math.max(0, boost.current - dt * 1.8)
    const kick = boost.current * 0.02 * size
    const bob = reducedMotion ? 0 : Math.sin(time * 0.6) * 0.015 * size
    group.position.set(
      ((rect.left + rect.width / 2) / width - 0.5) * visibleWidth + HEADING.x * kick,
      -((rect.top + rect.height / 2) / height - 0.5) * visibleHeight + HEADING.y * kick + bob,
      HEADING.z * kick,
    )
    group.scale.setScalar(scale)

    // Gentle drift and parallax towards the pointer.
    const sway = reducedMotion ? 0 : 1
    group.quaternion.copy(SHIP_ORIENTATION)
    group.rotateX(sway * Math.sin(time * 0.35) * 0.04)
    group.rotateY(state.pointer.x * 0.06 * sway)
    group.rotateZ(state.pointer.y * 0.04 * sway)

    // Engines follow the engaged speed level, spooling smoothly.
    const target = warpIntensity(gameStore.getState().game)
    throttle.current += (target - throttle.current) * Math.min(1, dt * 1.5)
    const drive = { throttle: throttle.current, boost: Math.min(1, boost.current), time, dt }
    const glow = 2 + throttle.current * 7 + drive.boost * 4
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
      light.current.intensity = (0.6 + throttle.current * 2 + drive.boost) * size * size
      light.current.distance = size * 2.5
    }

    // Newly installed modules grow into place from their own centre.
    const now = performance.now()
    for (const m of ship.modules) {
      if (!m.installedAt) continue
      const t = Math.min(1, (now - m.installedAt) / INSTALL_MS)
      const k = Math.max(0.001, easeOutBack(t))
      temp.pivot.copy(m.pivot)
      m.node.position
        .copy(temp.pivot)
        .sub(temp.v.copy(temp.pivot).sub(m.position).multiplyScalar(k))
      m.node.scale.copy(m.scale).multiplyScalar(k)
      if (t >= 1) m.installedAt = 0
    }
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
