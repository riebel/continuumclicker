import { Color, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three'
import { mulberry32 } from '../game/random'

/** Transforms of the glowing crystals studding a crystal asteroid. */
export function crystalTransforms(seed: number, count: number): Matrix4[] {
  const random = mulberry32(seed * 7919 + 1)
  const up = new Vector3(0, 1, 0)
  return Array.from({ length: count }, () => {
    const dir = new Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize()
    const length = 0.22 + random() * 0.26
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
export function createRockMaterial(base?: MeshStandardMaterial): RockMaterial {
  const uniforms = {
    uDamage: { value: 0 },
    uFlash: { value: 0 },
    uSeed: { value: 0 },
    uCrackColor: { value: new Color(4, 1.3, 0.35) },
  }
  const material =
    base?.clone() ??
    new MeshStandardMaterial({
      color: '#8a8078',
      roughness: 0.95,
      metalness: 0.05,
      vertexColors: true,
    })
  material.customProgramCacheKey = () => 'mining-crust-v2'
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
