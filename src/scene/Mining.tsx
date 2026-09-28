import { useFrame } from '@react-three/fiber'
import { type RefObject, useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  type Group,
  type InstancedMesh,
  type Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  type PointLight,
  type Sprite,
  SpriteMaterial,
  TetrahedronGeometry,
  Vector3,
} from 'three'
import type { AsteroidKind, Shot } from '../game/engine'
import { mulberry32 } from '../game/random'
import { gameStore } from '../game/store'
import { ASTEROID_LAYOUT, HEADING, layoutPosition, stageBox } from './constants'
import { createRockGeometry, createRockMaterial, crystalTransforms } from './rock'
import { asteroidOnScreen } from './target'

const CRYSTALS = 11
const SPARKS = 90
const CHUNKS = 60
const BEAM_SECONDS = 0.1
const SPAWN_SECONDS = 0.55

const LASER_COLOR = new Color(6, 1.6, 0.45)
const CRIT_COLOR = new Color(7, 5, 1.6)
const CRYSTAL_COLOR = new Color(1.2, 4.5, 6)

interface Particle {
  alive: boolean
  position: Vector3
  velocity: Vector3
  axis: Vector3
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
    spin: 0,
    angle: 0,
    age: 0,
    life: 1,
    size: 1,
  }))
}

function spawn(pool: Particle[]): Particle | undefined {
  return (
    pool.find((p) => !p.alive) ?? pool.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b))
  )
}

/** Soft radial falloff for glow sprites. */
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

interface Visual {
  seed: number
  kind: AsteroidKind
  spawnedAt: number
}

interface MiningProps {
  anchor: RefObject<HTMLElement | null>
  /** World position of the ship's bow, updated by the ship every frame. */
  bow: Vector3
  reducedMotion: boolean
}

/**
 * The asteroid in front of the ship, the mining laser and all hit effects. Reacts to shots from
 * the store; the ship itself stays calm.
 */
export function Mining({ anchor, bow, reducedMotion }: MiningProps) {
  const rock = useRef<Mesh>(null)
  const holder = useRef<Group>(null)
  const crystals = useRef<InstancedMesh>(null)
  const sparksMesh = useRef<InstancedMesh>(null)
  const chunksMesh = useRef<InstancedMesh>(null)
  const beam = useRef<Mesh>(null)
  const beamCore = useRef<Mesh>(null)
  const impact = useRef<Sprite>(null)
  const burst = useRef<Sprite>(null)
  const light = useRef<PointLight>(null)

  const assets = useMemo(() => {
    const rockMaterial = createRockMaterial()
    const glowTexture = createGlowTexture()
    return {
      rockMaterial,
      crystalGeometry: new OctahedronGeometry(1, 0),
      crystalMaterial: new MeshStandardMaterial({
        color: '#9ff4ff',
        emissive: '#3fd8ff',
        emissiveIntensity: 2.4,
        roughness: 0.25,
        metalness: 0.1,
        flatShading: true,
      }),
      sparkGeometry: new OctahedronGeometry(1, 0),
      sparkMaterial: new MeshBasicMaterial({ color: LASER_COLOR, toneMapped: false }),
      chunkGeometry: new TetrahedronGeometry(1, 0),
      chunkMaterial: new MeshStandardMaterial({
        color: '#7d746c',
        roughness: 0.95,
        flatShading: true,
      }),
      beamGeometry: new CylinderGeometry(1, 1, 1, 10, 1, true).rotateX(Math.PI / 2),
      beamMaterial: new MeshBasicMaterial({
        color: LASER_COLOR,
        toneMapped: false,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
      coreMaterial: new MeshBasicMaterial({
        color: new Color(8, 7, 6),
        toneMapped: false,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
      glowTexture,
      impactMaterial: new SpriteMaterial({
        map: glowTexture,
        color: LASER_COLOR,
        toneMapped: false,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
      burstMaterial: new SpriteMaterial({
        map: glowTexture,
        color: new Color(3, 1.8, 0.8),
        toneMapped: false,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    }
  }, [])

  useEffect(
    () => () => {
      for (const asset of Object.values(assets)) {
        if ('dispose' in asset) asset.dispose()
      }
      assets.rockMaterial.material.dispose()
    },
    [assets],
  )

  const sim = useMemo(
    () => ({
      visual: null as Visual | null,
      shots: [] as Shot[],
      sparks: createPool(SPARKS),
      chunks: createPool(CHUNKS),
      random: mulberry32(1),
      center: new Vector3(),
      radius: 1,
      shake: 0,
      flash: 0,
      damage: 0,
      beamAge: Number.POSITIVE_INFINITY,
      burstAge: Number.POSITIVE_INFINITY,
      burstSize: 1,
      burstAt: new Vector3(),
      hit: new Vector3(),
      tumbleAxis: new Vector3(0.3, 1, 0.2).normalize(),
      tumble: 0,
      dummy: new Object3D(),
      spot: new Vector3(),
      v: new Vector3(),
      w: new Vector3(),
      dir: new Vector3(),
    }),
    [],
  )

  // Queue shots; they are played back in the frame loop where the bow position is known.
  useEffect(
    () =>
      gameStore.subscribe((state, previous) => {
        if (state.lastShot && state.lastShot !== previous.lastShot) sim.shots.push(state.lastShot)
      }),
    [sim],
  )

  useFrame((state, delta) => {
    const element = anchor.current
    const mesh = rock.current
    const group = holder.current
    if (!element || !mesh || !group) return
    const dt = Math.min(delta, 0.1)
    const now = state.clock.elapsedTime
    const { game } = gameStore.getState()
    const random = sim.random

    // Place the asteroid ahead of the ship.
    const box = stageBox(element.getBoundingClientRect(), state.size)
    const spot = layoutPosition(box, ASTEROID_LAYOUT, sim.spot)
    const baseRadius = box.size * ASTEROID_LAYOUT.size

    const swap = (seed: number, kind: AsteroidKind) => {
      const old = mesh.geometry
      mesh.geometry = createRockGeometry(seed)
      old.dispose()
      assets.rockMaterial.uniforms.uSeed.value = (seed % 97) * 1.37
      assets.rockMaterial.uniforms.uCrackColor.value.copy(
        kind === 'crystal' ? CRYSTAL_COLOR : new Color(4, 1.3, 0.35),
      )
      const transforms = kind === 'crystal' ? crystalTransforms(seed, CRYSTALS) : []
      const instanced = crystals.current
      if (instanced) {
        for (const [i, matrix] of transforms.entries()) instanced.setMatrixAt(i, matrix)
        instanced.count = transforms.length
        instanced.instanceMatrix.needsUpdate = true
      }
      randomUnit(mulberry32(seed), sim.tumbleAxis)
      sim.visual = { seed, kind, spawnedAt: now }
      sim.damage = 0
    }

    const seed = game.asteroidsMined + 1
    if (!sim.visual) {
      swap(seed, game.asteroid.kind)
      sim.visual = { seed, kind: game.asteroid.kind, spawnedAt: -1 }
    }

    // Play back queued shots.
    for (const shot of sim.shots.splice(0)) {
      const kind = sim.visual.kind
      sim.v.copy(bow).sub(sim.center).normalize()
      randomUnit(random, sim.w)
        .cross(sim.v)
        .multiplyScalar(sim.radius * 0.35 * random())
      sim.hit
        .copy(sim.center)
        .addScaledVector(sim.v, sim.radius * 0.8)
        .add(sim.w)
      sim.beamAge = 0
      const color = shot.critical ? CRIT_COLOR : kind === 'crystal' ? CRYSTAL_COLOR : LASER_COLOR
      assets.beamMaterial.color.copy(color)
      assets.impactMaterial.color.copy(color)
      assets.sparkMaterial.color.copy(color)
      sim.flash = Math.max(sim.flash, shot.critical ? 1 : 0.55)
      sim.shake = Math.min(2, sim.shake + (shot.critical ? 1.6 : 0.8))

      const sparkCount = reducedMotion ? 3 : shot.critical ? 18 : 9
      for (let i = 0; i < sparkCount; i++) {
        const p = spawn(sim.sparks)
        if (!p) break
        p.alive = true
        p.position.copy(sim.hit)
        randomUnit(random, p.velocity)
          .addScaledVector(sim.v, 1.4)
          .normalize()
          .multiplyScalar(sim.radius * (2 + random() * 4))
        p.age = 0
        p.life = 0.25 + random() * 0.35
        p.size = sim.radius * (0.025 + random() * 0.03)
        randomUnit(random, p.axis)
        p.spin = 10
        p.angle = random() * 6
      }

      if (shot.target.hp <= 0) {
        // Break apart: chunks fly out, a flash, and the next asteroid drifts in.
        const chunkCount = reducedMotion ? 6 : 26
        for (let i = 0; i < chunkCount; i++) {
          const p = spawn(sim.chunks)
          if (!p) break
          p.alive = true
          randomUnit(random, sim.w)
          p.position.copy(sim.center).addScaledVector(sim.w, sim.radius * 0.5 * random())
          p.velocity.copy(sim.w).multiplyScalar(sim.radius * (1.2 + random() * 3))
          p.age = 0
          p.life = 0.8 + random() * 0.8
          p.size = sim.radius * (0.1 + random() * 0.22)
          randomUnit(random, p.axis)
          p.spin = 2 + random() * 6
          p.angle = random() * 6
        }
        sim.burstAge = 0
        sim.burstSize = sim.radius
        sim.burstAt.copy(sim.center)
        swap(seed, game.asteroid.kind)
      }
    }
    // Reset or a loaded game: follow the store without an explosion.
    if (sim.visual.seed !== seed) swap(seed, game.asteroid.kind)

    // Asteroid: drift in, tumble, shake, glow.
    const visual = sim.visual
    const t = visual.spawnedAt < 0 ? 1 : Math.min(1, (now - visual.spawnedAt) / SPAWN_SECONDS)
    const arrive = reducedMotion ? 1 : 1 - (1 - t) ** 3
    sim.radius = baseRadius * (visual.kind === 'crystal' ? 1.2 : 1)
    sim.center.copy(spot).addScaledVector(HEADING, (1 - arrive) * box.size * 0.6)
    sim.shake = Math.max(0, sim.shake - dt * 7)
    group.position.copy(sim.center)
    if (!reducedMotion && sim.shake > 0) {
      group.position.add(randomUnit(random, sim.w).multiplyScalar(sim.shake * sim.radius * 0.035))
    }
    group.scale.setScalar(sim.radius * Math.max(0.01, arrive))
    sim.tumble += dt * (reducedMotion ? 0 : 0.18)
    group.quaternion.setFromAxisAngle(sim.tumbleAxis, sim.tumble)

    const targetDamage = 1 - game.asteroid.hp / game.asteroid.maxHp
    sim.damage += (targetDamage - sim.damage) * Math.min(1, dt * 12)
    sim.flash = Math.max(0, sim.flash - dt * 10)
    assets.rockMaterial.uniforms.uDamage.value = sim.damage
    assets.rockMaterial.uniforms.uFlash.value = sim.flash * 0.25
    assets.crystalMaterial.emissiveIntensity = 2.4 + sim.flash * 4 + Math.sin(now * 3) * 0.4

    // Laser beam from the bow to the hit point.
    sim.beamAge += dt
    const beamOn = sim.beamAge < BEAM_SECONDS
    for (const [ref, width] of [
      [beam, 0.03],
      [beamCore, 0.01],
    ] as const) {
      const m = ref.current
      if (!m) continue
      m.visible = beamOn
      if (!beamOn) continue
      const fade = 1 - sim.beamAge / BEAM_SECONDS
      sim.w.copy(sim.hit).sub(bow)
      m.position.copy(bow).addScaledVector(sim.w, 0.5)
      m.quaternion.setFromUnitVectors(sim.v.set(0, 0, 1), sim.dir.copy(sim.w).normalize())
      const w = box.size * width * (0.4 + 0.6 * fade)
      m.scale.set(w, w, sim.w.length())
    }
    assets.beamMaterial.opacity = assets.coreMaterial.opacity = 1 - sim.beamAge / BEAM_SECONDS

    if (impact.current) {
      const glow = Math.max(0, 1 - sim.beamAge / (BEAM_SECONDS * 2))
      impact.current.visible = glow > 0
      impact.current.position.copy(sim.hit)
      impact.current.scale.setScalar(sim.radius * (0.6 + 0.9 * glow))
      assets.impactMaterial.opacity = glow
    }
    if (light.current) {
      light.current.position.copy(sim.hit)
      const glow = Math.max(0, 1 - sim.beamAge / 0.25)
      light.current.intensity = glow * 6 * box.size * box.size
      light.current.distance = box.size * 1.5
      light.current.color.copy(assets.beamMaterial.color).multiplyScalar(0.2)
    }

    // Break flash.
    sim.burstAge += dt
    if (burst.current) {
      const k = sim.burstAge / 0.45
      burst.current.visible = k < 1
      if (k < 1) {
        burst.current.position.copy(sim.burstAt)
        burst.current.scale.setScalar(sim.burstSize * (1.5 + 2.5 * k))
        assets.burstMaterial.opacity = (1 - k) ** 3
      }
    }

    // Particles.
    const step = (pool: Particle[], instanced: InstancedMesh | null, drag: number) => {
      if (!instanced) return
      let n = 0
      for (const p of pool) {
        if (!p.alive) continue
        p.age += dt
        if (p.age >= p.life) {
          p.alive = false
          continue
        }
        p.velocity.multiplyScalar(Math.max(0, 1 - drag * dt))
        p.position.addScaledVector(p.velocity, dt)
        p.angle += p.spin * dt
        const k = 1 - p.age / p.life
        sim.dummy.position.copy(p.position)
        sim.dummy.quaternion.setFromAxisAngle(p.axis, p.angle)
        sim.dummy.scale.setScalar(p.size * Math.min(1, k * 2.5))
        sim.dummy.updateMatrix()
        instanced.setMatrixAt(n++, sim.dummy.matrix)
      }
      instanced.count = n
      instanced.instanceMatrix.needsUpdate = true
    }
    step(sim.sparks, sparksMesh.current, 3)
    step(sim.chunks, chunksMesh.current, 0.8)

    // Tell the HTML overlay where the asteroid is on screen.
    sim.v.copy(sim.center).project(state.camera)
    sim.w.copy(sim.center).addScaledVector(state.camera.up, sim.radius).project(state.camera)
    asteroidOnScreen.x = ((sim.v.x + 1) / 2) * state.size.width
    asteroidOnScreen.y = ((1 - sim.v.y) / 2) * state.size.height
    asteroidOnScreen.radius = Math.abs(sim.w.y - sim.v.y) * 0.5 * state.size.height
    asteroidOnScreen.visible = true
  })

  useEffect(
    () => () => {
      asteroidOnScreen.visible = false
    },
    [],
  )

  return (
    <>
      <group ref={holder}>
        <mesh ref={rock} material={assets.rockMaterial.material} />
        <instancedMesh
          ref={crystals}
          args={[assets.crystalGeometry, assets.crystalMaterial, CRYSTALS]}
          frustumCulled={false}
        />
      </group>
      <instancedMesh
        ref={sparksMesh}
        args={[assets.sparkGeometry, assets.sparkMaterial, SPARKS]}
        instanceMatrix-usage={DynamicDrawUsage}
        frustumCulled={false}
      />
      <instancedMesh
        ref={chunksMesh}
        args={[assets.chunkGeometry, assets.chunkMaterial, CHUNKS]}
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
      <pointLight ref={light} decay={2} intensity={0} />
    </>
  )
}
