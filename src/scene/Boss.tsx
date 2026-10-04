import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { type RefObject, useEffect, useMemo } from 'react'
import {
  AdditiveBlending,
  Box3,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three'
import bossesUrl from '../assets/bosses.glb?url'
import { bossExposed, bossPhase } from '../game/bosses'
import { gameStore } from '../game/store'
import { layoutPosition, stageBox } from './constants'
import { PROJECTILE_SECONDS } from './miningField'
import { attachPlume, disposePlume, type Plume, updatePlume } from './plume'
import { bossOnScreen } from './target'
import { beamGeometry, beamMaterial, flashGeometry, flashMaterial } from './weaponVisuals'

export interface BossWorld {
  readonly center: Vector3
  readonly point: Vector3
  radius: number
}

export const createBossWorld = (): BossWorld => ({
  center: new Vector3(),
  point: new Vector3(),
  radius: 1,
})

function riftMaterial() {
  const uniforms = { uTime: { value: 0 }, uOpacity: { value: 0 } }
  return Object.assign(
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms,
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `
      varying vec2 vUv; uniform float uTime; uniform float uOpacity;
      void main(){
        vec2 p=(vUv-.5)*2.;float r=length(p);float a=atan(p.y,p.x);
        float ridge=.53+.023*sin(a*7.+uTime*.45)+.012*sin(a*19.-uTime*.7);
        float filaments=exp(-pow((r-ridge)/.014,2.))*.55;
        filaments+=exp(-pow((r-ridge-.045)/.008,2.))*.22;
        float haze=exp(-pow((r-.52)/.13,2.))*.065;
        float jets=pow(max(0.,sin(a*11.+uTime*.12)),12.)*exp(-pow((r-.65)/.12,2.))*.15;
        float pulse=.85+.15*sin(a*5.+uTime);
        vec3 color=mix(vec3(.38,.055,.16),vec3(.95,.52,.4),filaments);
        gl_FragColor=vec4(color*(filaments*2.+haze+jets)*pulse*uOpacity,1.);
      }`,
    }),
    { uniforms },
  )
}

/** Native articulated Blender geometry, staged approach and physically located weak points. */
export function Boss({
  anchor,
  world,
  collector,
  reducedMotion,
}: {
  anchor: RefObject<HTMLElement | null>
  world: BossWorld
  collector: Vector3
  reducedMotion: boolean
}) {
  const { scene } = useGLTF(bossesUrl, false, true)
  const assets = useMemo(() => {
    const group = new Group()
    const models = new Map<
      string,
      {
        root: Group
        span: number
        rig: {
          node: Object3D
          rest: Quaternion
          role: string
          index: number
          surfaces: MeshStandardMaterial[]
        }[]
        weakpoint: Object3D
        muzzles: Object3D[]
        materials: MeshStandardMaterial[]
        plumes: Plume[]
      }
    >()
    const materials: MeshStandardMaterial[] = []
    for (const id of ['leviathan', 'dreadnought']) {
      const prototype = scene.getObjectByName(id)
      if (!prototype) throw new Error(`Blender boss missing: ${id}`)
      const root = prototype.clone(true) as Group
      const span = new Box3().setFromObject(root).getSize(new Vector3()).length()
      const rig: {
        node: Object3D
        rest: Quaternion
        role: string
        index: number
        surfaces: MeshStandardMaterial[]
      }[] = []
      const owned: MeshStandardMaterial[] = []
      const outlets: Group[] = []
      let weakpoint = root as Object3D
      const muzzles: Object3D[] = []
      root.traverse((node) => {
        if (node.userData.bossWeakpoint) weakpoint = node
        if (node.userData.bossMuzzle) muzzles.push(node)
        if (['tendril', 'turret', 'weakpoint', 'crown'].includes(node.userData.bossPart))
          rig.push({
            node,
            rest: node.quaternion.clone(),
            role: node.userData.bossPart,
            index: rig.length,
            surfaces: [],
          })
        if (node.userData.nozzle) outlets.push(node as Group)
        if (!(node instanceof Mesh)) return
        const sourceMaterials = node.material
        const clones = [sourceMaterials].flat().map((source) => {
          const material = source.clone() as MeshStandardMaterial
          material.envMapIntensity = id === 'leviathan' ? 1.8 : 1.35
          owned.push(material)
          materials.push(material)
          return material
        })
        node.material = Array.isArray(sourceMaterials)
          ? clones
          : (clones[0] as MeshStandardMaterial)
      })
      for (const item of rig)
        item.node.traverse((node) => {
          if (node instanceof Mesh)
            item.surfaces.push(...([node.material].flat() as MeshStandardMaterial[]))
        })
      const plumes = outlets.map((node) =>
        attachPlume(node, node.userData.nozzle, node.userData.radius),
      )
      group.add(root)
      root.visible = false
      models.set(id, { root, span, rig, weakpoint, muzzles, materials: owned, plumes })
    }
    const rift = new Mesh(new PlaneGeometry(1, 1), riftMaterial())
    const attack = Array.from({ length: 3 }, () => new Mesh(beamGeometry, beamMaterial('#ff615b')))
    const charge = new Mesh(flashGeometry, flashMaterial('#ff8a91'))
    const blast = new Mesh(flashGeometry, flashMaterial('#ffbb8b'))
    const shieldUniforms = { uOpacity: { value: 0 } }
    const shield = new Mesh(
      new SphereGeometry(1, 48, 32),
      Object.assign(
        new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
          blending: AdditiveBlending,
          uniforms: shieldUniforms,
          vertexShader: `varying vec3 n;varying vec3 v;void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);v=-p.xyz;gl_Position=projectionMatrix*p;}`,
          fragmentShader: `varying vec3 n;varying vec3 v;uniform float uOpacity;void main(){float rim=pow(1.-abs(dot(normalize(n),normalize(v))),3.);gl_FragColor=vec4(vec3(.13,.55,1.2)*rim*uOpacity,rim*uOpacity);}`,
        }),
        { uniforms: shieldUniforms },
      ),
    )
    group.add(rift, ...attack, charge, blast, shield)
    const state = {
      group,
      models,
      materials,
      rift,
      attack,
      charge,
      blast,
      shield,
      direction: new Vector3(),
      attackOrigin: new Vector3(),
      axis: new Vector3(0, 0, 1),
      forward: new Vector3(1, 0, 0),
      local: new Vector3(),
      screen: new Vector3(),
      edge: new Vector3(),
      rotation: new Quaternion(),
      flashAge: 10,
      attackAge: 10,
      lastShot: 0,
      attackCount: 0,
      lastBoss: 0,
    }
    return state
  }, [scene])
  useEffect(
    () => () => {
      for (const material of assets.materials) material.dispose()
      for (const model of assets.models.values())
        for (const plume of model.plumes) disposePlume(plume)
      for (const mesh of [assets.rift, assets.shield]) {
        mesh.geometry.dispose()
        mesh.material.dispose()
      }
      for (const mesh of [...assets.attack, assets.charge, assets.blast]) mesh.material.dispose()
      bossOnScreen.visible = false
    },
    [assets],
  )

  useFrame((state, delta) => {
    const { boss, lastShot } = gameStore.getState()
    const element = anchor.current
    if (!element) return
    const dt = Math.min(delta, 0.1)
    const now = state.clock.elapsedTime
    for (const model of assets.models.values()) model.root.visible = false
    for (const mesh of [assets.rift, ...assets.attack, assets.charge, assets.blast, assets.shield])
      mesh.visible = false
    bossOnScreen.visible = false
    if (!boss) return
    const model = assets.models.get(boss.kind)
    if (!model) return
    if (boss.id !== assets.lastBoss) {
      assets.lastBoss = boss.id
      assets.attackCount = 0
      assets.flashAge = assets.attackAge = 10
    }
    const box = stageBox(element.getBoundingClientRect(), state.size)
    const approaching = boss.stage === 'warning'
    const departing = boss.stage === 'escaped'
    const destroyed = boss.stage === 'victory'
    const projectileKill = destroyed && ['plasma', 'swarm'].includes(boss.finisher ?? '')
    const deathAge = boss.age - (!reducedMotion && projectileKill ? PROJECTILE_SECONDS : 0)
    const approach = approaching ? Math.min(1, boss.age / 9) : 1
    const dissolve = destroyed ? Math.min(1, Math.max(0, (deathAge - 0.5) / 2.6)) : 0
    layoutPosition(box, { x: 0.17, y: 0.29, depth: -0.27 }, world.center)
    if (!reducedMotion) {
      world.center.x += Math.sin(now * 0.18) * box.size * 0.008
      world.center.y += Math.cos(now * 0.23) * box.size * 0.006
      world.center.z -= box.size * (1 - approach) * 1.4
      if (departing)
        world.center.addScaledVector(assets.direction.set(0.6, 0.3, -1), boss.age * box.size * 0.18)
    }
    model.root.position.copy(world.center)
    const scale =
      ((box.size * (boss.kind === 'leviathan' ? 0.72 : 0.66)) / model.span) *
      (approaching ? 0.65 + 0.35 * approach : 1)
    model.root.scale.setScalar(scale)
    assets.direction.copy(collector).sub(world.center).normalize()
    model.root.quaternion.setFromUnitVectors(assets.forward, assets.direction)
    if (!reducedMotion)
      model.root.position.addScaledVector(
        assets.direction,
        -Math.exp(-assets.flashAge * 18) * box.size * 0.003,
      )
    model.root.visible = dissolve < 0.99 && (!departing || boss.age < 3)
    const phase = bossPhase(boss)
    for (const rig of model.rig) {
      rig.node.quaternion.copy(rig.rest)
      if (rig.role === 'tendril' && !reducedMotion) {
        const angle =
          Math.sin(now * (0.48 + phase * 0.08) + rig.index * 1.9) * (0.055 + phase * 0.009)
        assets.rotation.setFromAxisAngle(assets.axis, angle)
        rig.node.quaternion.multiply(assets.rotation)
      }
      if (rig.role === 'weakpoint') {
        const opened = bossExposed(boss)
        for (const material of rig.surfaces)
          if (material instanceof MeshStandardMaterial && material.emissiveIntensity > 0)
            material.emissiveIntensity =
              (opened ? 3.4 : boss.kind === 'leviathan' ? 1.1 : 1.6) +
              Math.exp(-assets.flashAge * 20) * 1.5
      }
    }
    for (const material of model.materials) {
      material.transparent = approaching || departing || destroyed
      material.opacity = destroyed
        ? 1 - dissolve
        : departing
          ? Math.max(0, 1 - boss.age / 3)
          : approaching
            ? Math.min(1, approach * 2)
            : 1
      material.depthWrite = material.opacity > 0.95
    }
    for (const plume of model.plumes)
      updatePlume(plume, {
        time: reducedMotion ? 0 : now,
        throttle: 0.3 + phase * 0.12,
        dt: reducedMotion ? 0 : dt,
      })
    model.root.updateMatrixWorld(true)
    model.weakpoint.getWorldPosition(world.point)
    // Effect radius follows the weak point, rather than scaling missiles to the entire hull.
    world.radius = scale * (boss.kind === 'leviathan' ? 0.85 : 0.68)

    if (lastShot && lastShot.targetId === -boss.id && lastShot.id !== assets.lastShot) {
      assets.lastShot = lastShot.id
      assets.flashAge = 0
    }
    assets.flashAge += dt
    if (boss.attacks !== assets.attackCount) {
      assets.attackCount = boss.attacks
      assets.attackAge = 0
    }
    assets.attackAge += dt
    const charging = boss.stage === 'combat' && boss.attackIn < 2.3
    assets.charge.visible = charging
    assets.charge.position.copy(world.point)
    assets.charge.quaternion.copy(state.camera.quaternion)
    assets.charge.scale.setScalar(world.radius * (1.1 + (2.3 - boss.attackIn) * 0.25))
    assets.charge.material.uniforms.uAge.value = 0.07
    assets.charge.material.uniforms.uOpacity.value = charging
      ? ((2.3 - boss.attackIn) / 2.3) * 0.55
      : 0
    for (const [index, beam] of assets.attack.entries()) {
      beam.visible = assets.attackAge < 0.26 && (boss.kind === 'dreadnought' || index === 0)
      if (!beam.visible) continue
      const muzzle = model.muzzles[index * 4 + 1]
      if (muzzle) muzzle.getWorldPosition(assets.attackOrigin)
      else assets.attackOrigin.copy(world.point)
      assets.direction.copy(collector).sub(assets.attackOrigin)
      beam.position.copy(assets.attackOrigin).addScaledVector(assets.direction, 0.5)
      beam.quaternion.setFromUnitVectors(
        assets.axis,
        assets.local.copy(assets.direction).normalize(),
      )
      beam.scale.set(box.size * 0.005, box.size * 0.005, assets.direction.length())
      beam.material.uniforms.uTime.value = now
      beam.material.uniforms.uOpacity.value = Math.max(0, 1 - assets.attackAge / 0.26)
    }
    assets.shield.visible = assets.attackAge < 0.65
    assets.shield.position.copy(collector)
    assets.shield.scale.set(box.size * 0.23, box.size * 0.18, box.size * 0.22)
    assets.shield.material.uniforms.uOpacity.value = reducedMotion
      ? 0.12
      : Math.exp(-assets.attackAge * 5) * 0.55
    if (destroyed) {
      assets.blast.visible = deathAge >= 0 && deathAge < 2
      assets.blast.position.copy(world.center)
      assets.blast.quaternion.copy(state.camera.quaternion)
      assets.blast.scale.setScalar(box.size * (0.06 + Math.max(0, deathAge) * 0.14))
      assets.blast.material.uniforms.uAge.value = Math.min(0.9, Math.max(0, deathAge) * 0.6)
      assets.blast.material.uniforms.uOpacity.value = reducedMotion
        ? 0.12
        : Math.exp(-Math.max(0, deathAge) * 2) * 0.65
    }
    if (boss.kind === 'leviathan') {
      assets.rift.visible = !departing && dissolve < 0.99
      assets.rift.position.copy(world.center)
      assets.rift.position.z -= box.size * 0.12
      assets.rift.quaternion.copy(state.camera.quaternion)
      assets.rift.scale.setScalar(box.size * 0.82)
      assets.rift.material.uniforms.uTime.value = reducedMotion ? 0 : now
      assets.rift.material.uniforms.uOpacity.value = Math.min(1, approach * 1.5) * (1 - dissolve)
    }
    assets.screen.copy(world.point).project(state.camera)
    assets.edge
      .copy(world.point)
      .addScaledVector(state.camera.up, world.radius)
      .project(state.camera)
    bossOnScreen.x = (assets.screen.x + 1) * 0.5 * state.size.width
    bossOnScreen.y = (1 - assets.screen.y) * 0.5 * state.size.height
    bossOnScreen.radius = Math.abs(assets.edge.y - assets.screen.y) * 0.5 * state.size.height
    bossOnScreen.visible = boss.stage === 'combat'
  }, -2)
  return <primitive object={assets.group} />
}

useGLTF.preload(bossesUrl, false, true)
