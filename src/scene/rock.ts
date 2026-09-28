import {
  type BufferGeometry,
  Color,
  IcosahedronGeometry,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three'
import { mulberry32 } from '../game/random'

function hash(x: number, y: number, z: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
  return h - Math.floor(h)
}

function valueNoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const s = (t: number) => t * t * (3 - 2 * t)
  const fx = s(x - xi)
  const fy = s(y - yi)
  const fz = s(z - zi)
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  const corner = (dx: number, dy: number, dz: number) => hash(xi + dx, yi + dy, zi + dz)
  return lerp(
    lerp(
      lerp(corner(0, 0, 0), corner(1, 0, 0), fx),
      lerp(corner(0, 1, 0), corner(1, 1, 0), fx),
      fy,
    ),
    lerp(
      lerp(corner(0, 0, 1), corner(1, 0, 1), fx),
      lerp(corner(0, 1, 1), corner(1, 1, 1), fx),
      fy,
    ),
    fz,
  )
}

function fbm(x: number, y: number, z: number): number {
  let sum = 0
  let amplitude = 0.5
  let frequency = 1
  for (let octave = 0; octave < 4; octave++) {
    sum += amplitude * valueNoise(x * frequency, y * frequency, z * frequency)
    amplitude *= 0.5
    frequency *= 2.03
  }
  return sum
}

/**
 * A lumpy, faceted rock of radius ~1. Vertices are displaced by noise of their position, so the
 * duplicated vertices of the non-indexed icosphere stay welded and the facets stay closed.
 */
export function createRockGeometry(seed: number): BufferGeometry {
  const random = mulberry32(seed)
  const geometry = new IcosahedronGeometry(1, 7)
  const stretch = new Vector3(1 + random() * 0.4, 0.72 + random() * 0.25, 0.85 + random() * 0.3)
  const offset = random() * 100
  const position = geometry.getAttribute('position')
  const v = new Vector3()

  // A few craters: dents around random directions.
  const craters = Array.from({ length: 3 + Math.floor(random() * 3) }, () => ({
    dir: new Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(),
    size: 0.25 + random() * 0.3,
    depth: 0.06 + random() * 0.08,
  }))

  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).normalize()
    let r = 0.78 + 0.45 * fbm(v.x * 1.4 + offset, v.y * 1.4 + offset, v.z * 1.4 + offset)
    for (const crater of craters) {
      const d = v.distanceTo(crater.dir) / crater.size
      if (d < 1) r -= crater.depth * (1 - d * d) ** 2
    }
    v.multiplyScalar(r).multiply(stretch)
    position.setXYZ(i, v.x, v.y, v.z)
  }

  geometry.computeBoundingSphere()
  const radius = geometry.boundingSphere?.radius ?? 1
  geometry.scale(1 / radius, 1 / radius, 1 / radius)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

/** Transforms of the glowing crystals studding a crystal asteroid. */
export function crystalTransforms(seed: number, count: number): Matrix4[] {
  const random = mulberry32(seed * 7919 + 1)
  const up = new Vector3(0, 1, 0)
  return Array.from({ length: count }, () => {
    const dir = new Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize()
    const length = 0.35 + random() * 0.35
    const width = 0.1 + random() * 0.08
    return new Matrix4().compose(
      dir.clone().multiplyScalar(0.72),
      new Quaternion().setFromUnitVectors(up, dir),
      new Vector3(width, length, width),
    )
  })
}

export interface RockMaterial {
  readonly material: MeshStandardMaterial
  readonly uniforms: {
    /** 0..1: glowing cracks spread as the asteroid takes damage. */
    readonly uDamage: { value: number }
    /** 0..1: white-hot flash right after a hit. */
    readonly uFlash: { value: number }
    readonly uSeed: { value: number }
    readonly uCrackColor: { value: Color }
  }
}

/** Rock with mottled albedo and emissive cracks that open up with damage. */
export function createRockMaterial(): RockMaterial {
  const uniforms = {
    uDamage: { value: 0 },
    uFlash: { value: 0 },
    uSeed: { value: 0 },
    uCrackColor: { value: new Color(4, 1.3, 0.35) },
  }
  const material = new MeshStandardMaterial({
    color: '#8a8078',
    roughness: 0.95,
    metalness: 0.05,
    flatShading: true,
  })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform float uDamage;
        uniform float uFlash;
        uniform float uSeed;
        uniform vec3 uCrackColor;
        varying vec3 vLocal;
        float rockHash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float rockNoise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(rockHash(i), rockHash(i + vec3(1, 0, 0)), f.x),
                mix(rockHash(i + vec3(0, 1, 0)), rockHash(i + vec3(1, 1, 0)), f.x), f.y),
            mix(mix(rockHash(i + vec3(0, 0, 1)), rockHash(i + vec3(1, 0, 1)), f.x),
                mix(rockHash(i + vec3(0, 1, 1)), rockHash(i + vec3(1, 1, 1)), f.x), f.y),
            f.z);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        vec3 seeded = vLocal * 2.3 + uSeed;
        diffuseColor.rgb *= 0.65 + 0.55 * rockNoise(seeded) + 0.2 * rockNoise(seeded * 3.1);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        // Cracks run along the zero crossings of two noise layers; the finer layer only opens up
        // once the rock is badly damaged.
        vec3 q = vLocal * 2.2 + uSeed * 1.7;
        float coarse = abs(rockNoise(q) - 0.5);
        float fine = abs(rockNoise(q * 2.3 + 5.0) - 0.5) + 0.6 * (1.0 - uDamage) * 0.05;
        float width = 0.004 + 0.022 * uDamage;
        float crack = (1.0 - smoothstep(width * 0.4, width, min(coarse, fine))) * step(0.001, uDamage);
        totalEmissiveRadiance += uCrackColor * crack * (0.4 + uDamage) + vec3(1.4, 0.9, 0.6) * uFlash;`,
      )
  }
  return { material, uniforms }
}
