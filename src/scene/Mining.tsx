import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { type RefObject, useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  type Group,
  type InstancedMesh,
  type Mesh,
  MeshBasicMaterial,
  type MeshStandardMaterial,
  Object3D,
  type PointLight,
  type Sprite,
  SpriteMaterial,
  Vector3,
} from 'three'
import miningUrl from '../assets/mining.glb?url'
import { WEAPONS, type WeaponId } from '../game/content'
import { type Shot, warpIntensity } from '../game/engine'
import { mulberry32 } from '../game/random'
import { gameStore } from '../game/store'
import { CAMERA_DISTANCE, HEADING, layoutPosition, stageBox } from './constants'
import {
  beltVisibility,
  FIELD_SLOTS,
  type FieldRock,
  type FieldShot,
  MiningField,
  PROJECTILE_SECONDS,
} from './miningField'
import { createRockMaterial, crystalTransforms } from './rock'
import { asteroidOnScreen } from './target'
import { WeaponEffects } from './WeaponEffects'

const CRYSTALS = 11
const SPARKS = 90
const CHUNKS = 60
const SALVAGE = 32
const BEAM_SECONDS = 0.12
const LASER_COLOR = new Color(6, 1.6, 0.45)
const CRIT_COLOR = new Color(7, 5, 1.6)
const CRYSTAL_COLOR = new Color(1.2, 4.5, 6)
const HOT_ROCK = new Color(4, 1.3, 0.35)

interface Particle {
  alive: boolean
  position: Vector3
  velocity: Vector3
  axis: Vector3
  start: Vector3
  control: Vector3
  spin: number
  angle: number
  age: number
  life: number
  size: number
}

function createPool(count: number): Particle[] {
  return Array.from({ length: count }, () => ({
    alive: false,
    position: new Vector3(),
    velocity: new Vector3(),
    axis: new Vector3(0, 1, 0),
    start: new Vector3(),
    control: new Vector3(),
    spin: 0,
    angle: 0,
    age: 0,
    life: 1,
    size: 1,
  }))
}

function spawn(pool: Particle[]): Particle {
  return (pool.find((p) => !p.alive) ??
    pool.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b))) as Particle
}

function createGlowTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const context = canvas.getContext('2d')
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.25, 'rgba(255,255,255,0.45)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, 64, 64)
  }
  return new CanvasTexture(canvas)
}

const randomUnit = (random: () => number, out: Vector3) =>
  out.set(random() - 0.5, random() - 0.5, random() - 0.5).normalize()

interface MiningProps {
  anchor: RefObject<HTMLElement | null>
  bow: Vector3
  /** Shared acquisition point for the ship's aiming rig. */
  target: Vector3
  collector: Vector3
  reducedMotion: boolean
}

/** Persistent distant targets; acquisition and salvage never move the player's input. */
export function Mining({ anchor, bow, target, collector, reducedMotion }: MiningProps) {
  const { scene: models } = useGLTF(miningUrl, false, true)
  const holders = useRef<(Group | null)[]>([])
  const rocks = useRef<(Mesh | null)[]>([])
  const crystals = useRef<(InstancedMesh | null)[]>([])
  const sparksMesh = useRef<InstancedMesh>(null)
  const chunksMesh = useRef<InstancedMesh>(null)
  const salvageMesh = useRef<InstancedMesh>(null)
  const tethers = useRef<InstancedMesh>(null)
  const beam = useRef<Mesh>(null)
  const beamCore = useRef<Mesh>(null)
  const impact = useRef<Sprite>(null)
  const burst = useRef<Sprite>(null)
  const intake = useRef<Sprite>(null)
  const light = useRef<PointLight>(null)

  const assets = useMemo(() => {
    models.updateMatrixWorld(true)
    const get = (name: string) => {
      const mesh = models.getObjectByName(name) as Mesh
      if (!mesh?.isMesh) throw new Error(`Blender mining mesh missing: ${name}`)
      return mesh
    }
    const geometry = (name: string) => {
      const mesh = get(name)
      const result = mesh.geometry.clone()
      const source = result.getAttribute('position')
      // Flatten glTF quantization into floating-point positions before baking node transforms.
      const positions = new Float32Array(source.count * 3)
      for (let i = 0; i < source.count; i++) {
        positions[i * 3] = source.getX(i)
        positions[i * 3 + 1] = source.getY(i)
        positions[i * 3 + 2] = source.getZ(i)
      }
      result.setAttribute('position', new Float32BufferAttribute(positions, 3))
      return result.applyMatrix4(mesh.matrixWorld)
    }
    const rockMaterials = FIELD_SLOTS.map(() =>
      createRockMaterial(get('asteroid_0').material as MeshStandardMaterial),
    )
    for (const rock of rockMaterials) rock.material.transparent = true
    const crystalMaterials = FIELD_SLOTS.map(() => {
      const material = (get('mineral_crystal').material as MeshStandardMaterial).clone()
      material.transparent = true
      return material
    })
    const glowTexture = createGlowTexture()
    const additive = {
      toneMapped: false,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    }
    return {
      geometries: Array.from({ length: 4 }, (_, i) => geometry(`asteroid_${i}`)),
      rockMaterials,
      crystalMaterials,
      crystalGeometry: geometry('mineral_crystal'),
      crystalMaterial: (get('mineral_crystal').material as MeshStandardMaterial).clone(),
      sparkMaterial: new MeshBasicMaterial({ color: LASER_COLOR, toneMapped: false }),
      chunkGeometry: geometry('rock_fragment'),
      chunkMaterial: (get('rock_fragment').material as MeshStandardMaterial).clone(),
      beamGeometry: new CylinderGeometry(1, 1, 1, 10, 1, true).rotateX(Math.PI / 2),
      beamMaterial: new MeshBasicMaterial({ ...additive, color: LASER_COLOR }),
      coreMaterial: new MeshBasicMaterial({ ...additive, color: new Color(8, 7, 6) }),
      tractorMaterial: new MeshBasicMaterial({
        ...additive,
        color: new Color(0.3, 1.6, 2.1),
        opacity: 0.22,
      }),
      glowTexture,
      impactMaterial: new SpriteMaterial({ ...additive, map: glowTexture, color: LASER_COLOR }),
      burstMaterial: new SpriteMaterial({
        ...additive,
        map: glowTexture,
        color: new Color(3, 1.8, 0.8),
      }),
      intakeMaterial: new SpriteMaterial({ ...additive, map: glowTexture, color: CRYSTAL_COLOR }),
    }
  }, [models])

  useEffect(
    () => () => {
      for (const geometry of assets.geometries) geometry.dispose()
      for (const material of assets.rockMaterials) material.material.dispose()
      for (const material of assets.crystalMaterials) material.dispose()
      for (const asset of Object.values(assets)) if ('dispose' in asset) asset.dispose()
      asteroidOnScreen.visible = false
    },
    [assets],
  )

  const sim = useMemo(() => {
    const { game, miningTarget } = gameStore.getState()
    return {
      field: new MiningField(miningTarget, game.asteroid.kind),
      shots: [] as (Shot & FieldShot & { arrivesAt: number })[],
      now: 0,
      asteroid: game.asteroid,
      projectileHit: new Vector3(),
      displayed: FIELD_SLOTS.map(() => -1),
      mineral: FIELD_SLOTS.map(() => false),
      crystalModels: FIELD_SLOTS.map(() => -1),
      centers: FIELD_SLOTS.map(() => new Vector3()),
      radii: FIELD_SLOTS.map(() => 1),
      clocks: FIELD_SLOTS.map(() => 0),
      axes: FIELD_SLOTS.map((_, i) => randomUnit(mulberry32(i + 7), new Vector3())),
      sparks: createPool(SPARKS),
      chunks: createPool(CHUNKS),
      salvage: createPool(SALVAGE),
      random: mulberry32(1),
      center: new Vector3(),
      radius: 1,
      beamAge: Number.POSITIVE_INFINITY,
      weapon: 'pulse' as WeaponId,
      beamWidth: 1,
      burstAge: Number.POSITIVE_INFINITY,
      burstSize: 1,
      burstAt: new Vector3(),
      pullAge: 10,
      pullAt: new Vector3(),
      intakeGlow: 0,
      hit: new Vector3(),
      hitOffset: new Vector3(),
      hitTarget: null as FieldRock | null,
      chainTarget: new Vector3(),
      dummy: new Object3D(),
      v: new Vector3(),
      w: new Vector3(),
      dir: new Vector3(),
    }
  }, [])

  useEffect(
    () =>
      gameStore.subscribe((state, previous) => {
        if (state.miningTarget < previous.miningTarget || (!state.lastShot && previous.lastShot)) {
          sim.shots.length = 0
          sim.field.reset(state.miningTarget, state.game.asteroid.kind)
          sim.asteroid = state.game.asteroid
          sim.hitTarget = null
          sim.beamAge = sim.burstAge = Number.POSITIVE_INFINITY
          sim.intakeGlow = 0
          for (const pool of [sim.sparks, sim.chunks, sim.salvage])
            for (const particle of pool) particle.alive = false
        } else if (
          state.miningTarget !== previous.miningTarget &&
          state.lastShot === previous.lastShot
        ) {
          sim.field.pass(state.miningTarget, state.game.asteroid)
          sim.asteroid = state.game.asteroid
        }
        if (state.lastShot && state.lastShot !== previous.lastShot) {
          const ordinal = state.lastShot.targetId
          const slot = sim.field.slot(ordinal)
          const center = sim.centers[slot] as Vector3
          sim.v.copy(bow).sub(center).normalize()
          sim.projectileHit.copy(center).addScaledVector(sim.v, (sim.radii[slot] ?? 1) * 0.85)
          sim.chainTarget.copy(sim.centers[sim.field.slot(ordinal + 1)] as Vector3)
          const travel =
            !reducedMotion && ['plasma', 'swarm'].includes(state.lastShot.weapon)
              ? PROJECTILE_SECONDS
              : 0
          sim.shots.push({
            ...state.lastShot,
            ordinal,
            next: state.game.asteroid,
            nextOrdinal: state.lastShot.nextTargetId,
            arrivesAt: Math.max(sim.now + travel, sim.shots.at(-1)?.arrivesAt ?? 0),
          })
        }
      }),
    [sim, bow, reducedMotion],
  )

  useFrame((state, delta) => {
    const element = anchor.current
    if (!element) return
    const dt = Math.min(delta, 0.1)
    const now = state.clock.elapsedTime
    sim.now = now
    const { game, miningTarget, actions } = gameStore.getState()
    const random = sim.random
    const box = stageBox(element.getBoundingClientRect(), state.size)
    if (!sim.shots.length && sim.field.ordinal !== miningTarget)
      sim.field.reset(miningTarget, game.asteroid.kind)
    const passing = sim.field.advance(dt, warpIntensity(game), reducedMotion, sim.shots.length > 0)
    if (!sim.shots.length) {
      const selected = sim.field.prepareNext()
      if (selected !== null) actions.prepareTarget(miningTarget, selected)
    }
    sim.pullAge += dt

    const positionField = (advance: boolean) => {
      for (const [i] of FIELD_SLOTS.entries()) {
        const visual = sim.field.rocks[i]
        const spec = FIELD_SLOTS[visual?.lane ?? i]
        const holder = holders.current[i]
        const mesh = rocks.current[i]
        const mineral = crystals.current[i]
        const material = assets.rockMaterials[i]
        const center = sim.centers[i]
        if (!visual || !spec || !holder || !mesh || !material || !center) continue
        const active = i === sim.field.slot()
        const frozen = active && game.frozen
        if (advance && !reducedMotion && !frozen)
          sim.clocks[visual.lane] = (sim.clocks[visual.lane] ?? 0) + dt
        const clock = sim.clocks[visual.lane] ?? 0
        layoutPosition(box, spec, center)
        // Fixed world scale + approach in depth produces real perspective growth.
        // Every lane streams opposite the same heading used by the warp starfield.
        const phase = reducedMotion ? 0.32 : visual.phase
        center.addScaledVector(HEADING, box.size * (0.32 - phase) * 1.9)
        center.x += box.size * Math.sin(clock * 0.16 + visual.lane * 1.7) * 0.012
        center.y += box.size * Math.cos(clock * 0.13 + visual.lane * 2.3) * 0.009
        const visibility = reducedMotion ? 1 : beltVisibility(phase)
        holder.visible = visibility > 0.001
        material.material.opacity = visibility
        const crystalMaterial = assets.crystalMaterials[i]
        if (crystalMaterial) crystalMaterial.opacity = visibility
        if (sim.pullAge < 0.75 && !active && !reducedMotion) {
          const pull =
            Math.sin((sim.pullAge / 0.75) * Math.PI) *
            0.3 *
            Math.exp(-center.distanceTo(sim.pullAt) / box.size)
          center.lerp(sim.pullAt, pull)
        }
        const perspective = (CAMERA_DISTANCE - spec.depth * box.size) / CAMERA_DISTANCE
        const radius = box.size * spec.size * perspective * (visual.kind === 'crystal' ? 1.12 : 1)
        sim.radii[i] = radius
        holder.position.copy(center)
        if (advance) visual.shake = Math.max(0, visual.shake - dt * 7)
        if (!reducedMotion && visual.shake)
          holder.position.add(
            randomUnit(random, sim.w).multiplyScalar(visual.shake * radius * 0.025),
          )
        holder.scale.setScalar(radius)
        holder.quaternion.setFromAxisAngle(
          sim.axes[visual.lane] as Vector3,
          clock * (0.065 + visual.lane * 0.012),
        )
        if (sim.displayed[i] !== visual.model) {
          mesh.geometry = assets.geometries[
            visual.model % assets.geometries.length
          ] as Mesh['geometry']
          sim.displayed[i] = visual.model
          material.uniforms.uSeed.value = (visual.model * 1.37) % 97
        }
        if (
          mineral &&
          (sim.mineral[i] !== (visual.kind === 'crystal') || sim.crystalModels[i] !== visual.model)
        ) {
          const transforms =
            visual.kind === 'crystal' ? crystalTransforms(visual.model + 1, CRYSTALS) : []
          for (const [n, m] of transforms.entries()) mineral.setMatrixAt(n, m)
          mineral.count = transforms.length
          mineral.instanceMatrix.needsUpdate = true
          sim.mineral[i] = visual.kind === 'crystal'
          sim.crystalModels[i] = visual.model
        }
        if (mineral && visual.kind !== 'crystal') mineral.count = 0
        if (advance) visual.flash = Math.max(0, visual.flash - dt * 8)
        material.uniforms.uDamage.value = visual.damage
        material.uniforms.uFlash.value = visual.flash * 0.22
        material.uniforms.uCrackColor.value.copy(
          frozen || visual.kind === 'crystal' ? CRYSTAL_COLOR : HOT_ROCK,
        )
      }
    }
    positionField(true)

    // Homing rounds follow the moving target until impact; acquisition waits for them.
    const flying = sim.shots.at(-1)
    if (flying) {
      const slot = sim.field.slot(flying.ordinal)
      const center = sim.centers[slot] as Vector3
      sim.v.copy(bow).sub(center).normalize()
      sim.projectileHit.copy(center).addScaledVector(sim.v, (sim.radii[slot] ?? 1) * 0.85)
    }

    const arrived: typeof sim.shots = []
    while (sim.shots[0] && sim.shots[0].arrivesAt <= now) {
      const shot = sim.shots.shift()
      if (shot) arrived.push(shot)
    }
    for (const shot of arrived) {
      if (sim.field.ordinal !== shot.ordinal) sim.field.reset(shot.ordinal, shot.target.kind)
      const slot = sim.field.slot(shot.ordinal)
      const center = sim.centers[slot] as Vector3
      const radius = sim.radii[slot] ?? 1
      sim.v.copy(bow).sub(center).normalize()
      randomUnit(random, sim.w)
        .cross(sim.v)
        .multiplyScalar(radius * 0.25 * random())
      sim.hit
        .copy(center)
        .addScaledVector(sim.v, radius * 0.85)
        .add(sim.w)
      sim.hitOffset.copy(sim.hit).sub(center)
      sim.hitTarget = shot.target.hp > 0 ? sim.field.target : null
      sim.chainTarget.copy(sim.centers[sim.field.slot(shot.ordinal + 1)] as Vector3)
      sim.beamAge = 0
      sim.weapon = shot.weapon
      sim.beamWidth =
        shot.weapon === 'railgun'
          ? 0.4
          : shot.weapon === 'singularity'
            ? 1.7
            : shot.special
              ? 1.3
              : 1
      const color =
        shot.weapon !== 'pulse'
          ? new Color(WEAPONS.find((w) => w.id === shot.weapon)?.color).multiplyScalar(3)
          : shot.critical
            ? CRIT_COLOR
            : shot.target.kind === 'crystal'
              ? CRYSTAL_COLOR
              : LASER_COLOR
      assets.beamMaterial.color.copy(color)
      assets.impactMaterial.color.copy(color)
      assets.sparkMaterial.color.copy(color)
      const emit = (pool: Particle[], count: number, debris: boolean) => {
        for (let i = 0; i < count; i++) {
          const p = spawn(pool)
          p.alive = true
          p.position.copy(debris ? center : sim.hit)
          randomUnit(random, p.velocity)
          if (!debris) p.velocity.addScaledVector(sim.v, 1.4).normalize()
          p.velocity.multiplyScalar(radius * (debris ? 1.2 + random() * 3 : 2 + random() * 4))
          p.velocity.addScaledVector(HEADING, -sim.field.speed * box.size * 1.9)
          p.age = 0
          p.life = debris ? 0.9 + random() * 0.7 : 0.25 + random() * 0.3
          p.size = radius * (debris ? 0.08 + random() * 0.17 : 0.02 + random() * 0.025)
          randomUnit(random, p.axis)
          p.spin = debris ? 2 + random() * 5 : 10
          p.angle = random() * 6
        }
      }
      emit(sim.sparks, reducedMotion ? 3 : shot.critical ? 18 : 9, false)
      if (shot.target.hp <= 0) {
        emit(sim.chunks, reducedMotion ? 4 : 22, true)
        if (!reducedMotion)
          for (let i = 0; i < (shot.target.kind === 'crystal' ? 8 : 4); i++) {
            const p = spawn(sim.salvage)
            p.alive = true
            p.age = 0
            p.life = 0.85 + random() * 0.45
            p.size = radius * (0.075 + random() * 0.07)
            p.start.copy(center).add(randomUnit(random, sim.w).multiplyScalar(radius * 0.35))
            p.control.copy(p.start).add(randomUnit(random, sim.w).multiplyScalar(radius * 2.3))
            p.position.copy(p.start)
            randomUnit(random, p.axis)
            p.angle = random() * 6
            p.spin = 3
          }
        sim.burstAge = 0
        sim.burstSize = radius
        sim.burstAt.copy(center)
      }
      if (shot.weapon === 'singularity' && shot.special) {
        sim.pullAge = 0
        sim.pullAt.copy(center)
      }
      sim.field.apply(shot, now)
      sim.asteroid = shot.next
    }
    if (passing && !sim.shots.length && sim.field.ordinal === miningTarget)
      actions.passTarget(miningTarget)
    if (!sim.shots.length) sim.asteroid = gameStore.getState().game.asteroid
    sim.field.target.kind = sim.asteroid.kind
    sim.field.target.damage = 1 - sim.asteroid.hp / sim.asteroid.maxHp
    positionField(false)
    sim.center.copy(sim.centers[sim.field.slot()] as Vector3)
    sim.radius = sim.radii[sim.field.slot()] ?? 1
    target.copy(sim.center)

    if (sim.hitTarget) {
      const center = sim.centers[sim.field.rocks.indexOf(sim.hitTarget)]
      if (center) sim.hit.copy(center).add(sim.hitOffset)
    }

    // Impact stays in world space even when acquisition moves to the next asteroid.
    sim.beamAge += dt
    const beamOn = sim.beamAge < BEAM_SECONDS && !['swarm', 'plasma', 'tesla'].includes(sim.weapon)
    for (const [ref, width] of [
      [beam, 0.0035],
      [beamCore, 0.0012],
    ] as const) {
      const mesh = ref.current
      if (!mesh) continue
      mesh.visible = beamOn
      if (!beamOn) continue
      sim.w.copy(sim.hit).sub(bow)
      mesh.position.copy(bow).addScaledVector(sim.w, 0.5)
      mesh.quaternion.setFromUnitVectors(sim.v.set(0, 0, 1), sim.dir.copy(sim.w).normalize())
      const w = box.size * width * sim.beamWidth * (1 - (sim.beamAge / BEAM_SECONDS) * 0.6)
      mesh.scale.set(w, w, sim.w.length())
    }
    assets.beamMaterial.opacity = assets.coreMaterial.opacity = Math.max(
      0,
      1 - sim.beamAge / BEAM_SECONDS,
    )
    if (impact.current) {
      const glow = Math.max(0, 1 - sim.beamAge / 0.2)
      impact.current.visible = glow > 0
      impact.current.position.copy(sim.hit)
      impact.current.scale.setScalar(sim.radius * (0.5 + glow))
      assets.impactMaterial.opacity = glow
    }
    if (light.current) {
      light.current.position.copy(sim.hit)
      light.current.intensity = Math.max(0, 1 - sim.beamAge / 0.22) * 0.12 * box.size ** 2
      light.current.distance = box.size * 0.55
      light.current.color.copy(assets.beamMaterial.color).multiplyScalar(0.2)
    }
    sim.burstAge += dt
    if (burst.current) {
      const k = sim.burstAge / 0.45
      burst.current.visible = k < 1
      if (k < 1) {
        burst.current.position.copy(sim.burstAt)
        burst.current.scale.setScalar(sim.burstSize * (1.5 + 2 * k))
        assets.burstMaterial.opacity = (1 - k) ** 3
      }
    }

    const step = (
      pool: Particle[],
      instanced: InstancedMesh | null,
      drag: number,
      collect = false,
    ) => {
      if (!instanced) return
      let count = 0
      let strands = 0
      for (const p of pool) {
        if (!p.alive) continue
        p.age += dt
        if (p.age >= p.life) {
          p.alive = false
          if (collect) sim.intakeGlow = 1
          continue
        }
        const t = p.age / p.life
        if (collect) {
          // Outward fracture arc, then an accelerating pull into the cargo intake.
          const k = t ** 2
          p.position
            .copy(p.start)
            .multiplyScalar((1 - k) ** 2)
            .addScaledVector(p.control, 2 * (1 - k) * k)
            .addScaledVector(collector, k * k)
          if (t > 0.18 && tethers.current) {
            sim.w.copy(p.position).sub(collector)
            sim.dummy.position.copy(collector).addScaledVector(sim.w, 0.5)
            sim.dummy.quaternion.setFromUnitVectors(
              sim.v.set(0, 0, 1),
              sim.dir.copy(sim.w).normalize(),
            )
            sim.dummy.scale.set(box.size * 0.0009, box.size * 0.0009, sim.w.length())
            sim.dummy.updateMatrix()
            tethers.current.setMatrixAt(strands++, sim.dummy.matrix)
          }
        } else {
          p.velocity.multiplyScalar(Math.max(0, 1 - drag * dt))
          p.position.addScaledVector(p.velocity, dt)
        }
        p.angle += p.spin * dt
        sim.dummy.position.copy(p.position)
        sim.dummy.quaternion.setFromAxisAngle(p.axis, p.angle)
        sim.dummy.scale.setScalar(p.size * Math.min(1, (1 - t) * 3))
        sim.dummy.updateMatrix()
        instanced.setMatrixAt(count++, sim.dummy.matrix)
      }
      instanced.count = count
      instanced.instanceMatrix.needsUpdate = true
      if (collect && tethers.current) {
        tethers.current.count = strands
        tethers.current.instanceMatrix.needsUpdate = true
      }
    }
    step(sim.sparks, sparksMesh.current, 3)
    step(sim.chunks, chunksMesh.current, 0.8)
    step(sim.salvage, salvageMesh.current, 0, true)
    sim.intakeGlow = Math.max(0, sim.intakeGlow - dt * 5)
    if (intake.current) {
      intake.current.visible = sim.intakeGlow > 0
      intake.current.position.copy(collector)
      intake.current.scale.setScalar(box.size * 0.045)
      assets.intakeMaterial.opacity = sim.intakeGlow * 0.5
    }

    sim.v.copy(sim.center).project(state.camera)
    sim.w.copy(sim.center).addScaledVector(state.camera.up, sim.radius).project(state.camera)
    asteroidOnScreen.x = ((sim.v.x + 1) / 2) * state.size.width
    asteroidOnScreen.y = ((1 - sim.v.y) / 2) * state.size.height
    asteroidOnScreen.radius = Math.abs(sim.w.y - sim.v.y) * 0.5 * state.size.height
    asteroidOnScreen.visible = true
    Object.assign(asteroidOnScreen, sim.asteroid)
  })

  return (
    <>
      {FIELD_SLOTS.map((spec, i) => (
        <group
          key={spec.x}
          ref={(node) => {
            holders.current[i] = node
          }}
        >
          <mesh
            ref={(node) => {
              rocks.current[i] = node
            }}
            geometry={assets.geometries[i % 4] as Mesh['geometry']}
            material={(assets.rockMaterials[i] as ReturnType<typeof createRockMaterial>).material}
          />
          <instancedMesh
            ref={(node) => {
              crystals.current[i] = node
            }}
            args={[assets.crystalGeometry, assets.crystalMaterials[i], CRYSTALS]}
            count={0}
            frustumCulled={false}
          />
        </group>
      ))}
      <instancedMesh
        ref={sparksMesh}
        args={[assets.crystalGeometry, assets.sparkMaterial, SPARKS]}
        count={0}
        instanceMatrix-usage={DynamicDrawUsage}
        frustumCulled={false}
      />
      <instancedMesh
        ref={chunksMesh}
        args={[assets.chunkGeometry, assets.chunkMaterial, CHUNKS]}
        count={0}
        instanceMatrix-usage={DynamicDrawUsage}
        frustumCulled={false}
      />
      <instancedMesh
        ref={salvageMesh}
        args={[assets.crystalGeometry, assets.crystalMaterial, SALVAGE]}
        count={0}
        instanceMatrix-usage={DynamicDrawUsage}
        frustumCulled={false}
      />
      <instancedMesh
        ref={tethers}
        args={[assets.beamGeometry, assets.tractorMaterial, SALVAGE]}
        count={0}
        instanceMatrix-usage={DynamicDrawUsage}
        frustumCulled={false}
      />
      <mesh
        ref={beam}
        geometry={assets.beamGeometry}
        material={assets.beamMaterial}
        visible={false}
      />
      <mesh
        ref={beamCore}
        geometry={assets.beamGeometry}
        material={assets.coreMaterial}
        visible={false}
      />
      <sprite ref={impact} material={assets.impactMaterial} visible={false} />
      <sprite ref={burst} material={assets.burstMaterial} visible={false} />
      <sprite ref={intake} material={assets.intakeMaterial} visible={false} />
      <pointLight ref={light} decay={2} intensity={0} />
      <WeaponEffects
        bow={bow}
        target={sim.projectileHit}
        chainTarget={sim.chainTarget}
        asteroid={sim}
        reducedMotion={reducedMotion}
      />
    </>
  )
}

useGLTF.preload(miningUrl, false, true)
