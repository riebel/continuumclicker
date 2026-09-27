import {
  AdditiveBlending,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  type Object3D,
  ShaderMaterial,
} from 'three'

/** Unit plume: radius 1 at the nozzle, extending along +Y from 0 to 1. */
const geometry = new CylinderGeometry(1, 1, 1, 28, 12, true).translate(0, 0.5, 0)

const vertexShader = /* glsl */ `
  uniform float uLength;
  uniform float uTaper;
  uniform float uTime;
  uniform float uSeed;
  varying float vAlong;
  varying vec3 vNormal;
  varying vec3 vView;

  void main() {
    float y = position.y;
    // Slight bulge right behind the nozzle, then a long taper.
    float radius = (1.0 + 0.12 * sin(y * 3.14159)) * mix(1.0, uTaper, pow(y, 0.7));
    // Turbulence wobble towards the tail.
    radius *= 1.0 + 0.06 * y * sin(uTime * 31.0 + uSeed * 17.0 + y * 13.0);
    vec3 p = vec3(position.x * radius, y * uLength, position.z * radius);
    vec4 view = modelViewMatrix * vec4(p, 1.0);
    vAlong = y;
    vNormal = normalize(normalMatrix * vec3(position.x, 0.0, position.z));
    vView = -view.xyz;
    gl_Position = projectionMatrix * view;
  }
`

const fragmentShader = /* glsl */ `
  uniform float uIntensity;
  uniform float uThrottle;
  uniform float uTime;
  uniform float uSeed;
  uniform float uCore;
  uniform float uDiamonds;
  varying float vAlong;
  varying vec3 vNormal;
  varying vec3 vView;

  void main() {
    // With MSAA, edge pixels are shaded slightly outside the triangle, so the interpolated vAlong can
    // leave 0..1. pow() of a negative base is NaN, and bloom would smear a NaN over the whole frame.
    float along = clamp(vAlong, 0.0, 1.0);
    // Soft volumetric edges: bright where we look through the thickest part of the plume.
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float body = pow(facing, mix(1.6, 3.0, uCore));
    float fade = pow(1.0 - along, mix(1.4, 2.4, uCore)) * smoothstep(0.0, 0.04, along + 0.02);

    float flicker = 0.88 + 0.12 * sin(uTime * 47.0 + uSeed * 9.0) * sin(uTime * 29.0 + along * 18.0);

    // Mach diamonds: standing shock waves in the exhaust core at high thrust.
    float diamonds = pow(max(0.0, cos(along * uDiamonds * 6.2832)), 10.0)
      * uCore * smoothstep(0.35, 0.9, uThrottle) * (1.0 - along);

    vec3 hot = vec3(1.0, 0.93, 0.78);
    vec3 warm = vec3(1.0, 0.58, 0.16);
    vec3 cool = vec3(0.85, 0.22, 0.05);
    vec3 color = mix(hot, warm, smoothstep(0.0, 0.35, along));
    color = mix(color, cool, smoothstep(0.3, 1.0, along));
    color = mix(color, hot, uCore * (1.0 - along) * 0.7);

    float strength = (body * fade * flicker + diamonds * 1.5) * uIntensity;
    gl_FragColor = vec4(color * strength, 1.0);
  }
`

export type NozzleKind = 'main' | 'nacelle' | 'rcs'

export interface Plume {
  readonly nozzle: Object3D
  readonly kind: NozzleKind
  readonly radius: number
  readonly outer: Mesh<CylinderGeometry, ShaderMaterial>
  readonly core: Mesh<CylinderGeometry, ShaderMaterial>
  readonly seed: number
  /** RCS pulse envelope, 0..1. */
  pulse: number
}

function plumeMaterial(core: boolean, seed: number) {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: {
      uLength: { value: 1 },
      uTaper: { value: core ? 0.15 : 0.35 },
      uIntensity: { value: 1 },
      uThrottle: { value: 0 },
      uTime: { value: 0 },
      uSeed: { value: seed },
      uCore: { value: core ? 1 : 0 },
      uDiamonds: { value: 4 },
    },
  })
}

/** Attaches an exhaust plume to a nozzle marker exported from Blender (exhaust along local +Y). */
export function attachPlume(nozzle: Object3D, kind: NozzleKind, radius: number): Plume {
  const seed = Math.random() * 100
  const outer = new Mesh(geometry, plumeMaterial(false, seed))
  const core = new Mesh(geometry, plumeMaterial(true, seed))
  core.scale.set(0.5, 1, 0.5)
  outer.renderOrder = core.renderOrder = 2
  outer.frustumCulled = core.frustumCulled = false
  // The markers are scaled with the model; the plume is sized in nozzle radii.
  const holder = new Group()
  holder.scale.setScalar(radius)
  holder.add(outer, core)
  nozzle.add(holder)
  return { nozzle, kind, radius, outer, core, seed, pulse: 0 }
}

export interface PlumeDrive {
  /** 0..1 engaged speed. */
  throttle: number
  /** 0..1 short boost after a click. */
  boost: number
  time: number
  dt: number
}

/** Updates plume length, brightness and flicker for the current drive state. */
export function updatePlume(plume: Plume, { throttle, boost, time, dt }: PlumeDrive) {
  let power: number
  if (plume.kind === 'rcs') {
    // Manoeuvring jets fire short random puffs, more of them while clicking.
    if (Math.random() < dt * (0.35 + boost * 6)) plume.pulse = 1
    plume.pulse = Math.max(0, plume.pulse - dt * 5)
    power = plume.pulse
  } else {
    power = Math.min(1.3, 0.07 + throttle * 0.95 + boost * 0.35)
  }

  const visible = power > 0.01
  plume.outer.visible = plume.core.visible = visible
  if (!visible) return

  const length = plume.kind === 'rcs' ? 2.2 * power : 1.4 + power * 9
  for (const [mesh, lengthFactor, intensity] of [
    [plume.outer, 1, 1.4 + power * 3.2],
    [plume.core, 0.62, 3 + power * 7],
  ] as const) {
    const u = mesh.material.uniforms
    if (!u.uLength || !u.uIntensity || !u.uThrottle || !u.uTime || !u.uDiamonds) continue
    u.uLength.value = length * lengthFactor
    u.uIntensity.value = intensity
    u.uThrottle.value = power
    u.uTime.value = time
    u.uDiamonds.value = 2.5 + power * 3
  }
}

export function disposePlume(plume: Plume) {
  plume.outer.material.dispose()
  plume.core.material.dispose()
  plume.outer.parent?.removeFromParent()
}
