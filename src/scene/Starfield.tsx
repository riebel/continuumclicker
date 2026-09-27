import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  ShaderMaterial,
} from 'three'
import { CAMERA_DISTANCE, HEADING } from './constants'

const COUNT = 1600
const BOX_MIN = [-70, -45, -180] as const
const BOX_SIZE = [140, 90, CAMERA_DISTANCE + 175] as const

const vertexShader = /* glsl */ `
  uniform float uTravel;
  uniform float uStreak;
  uniform float uPixel;
  uniform vec3 uHeading;
  uniform vec3 uBoxMin;
  uniform vec3 uBoxSize;
  attribute vec3 aOffset;
  attribute vec3 aColor;
  attribute float aSize;
  varying vec3 vColor;
  varying vec2 vUv;
  varying float vFade;

  void main() {
    // Stars stream against the ship's heading and wrap around a box in front of the camera.
    vec3 head = mod(aOffset - uHeading * uTravel - uBoxMin, uBoxSize) + uBoxMin;
    vec3 tail = head + uHeading * uStreak * aSize;
    vec4 h = viewMatrix * vec4(head, 1.0);
    vec4 t = viewMatrix * vec4(tail, 1.0);

    // position.x: 0 at the head, 1 at the tail; position.y: -1..1 across the streak.
    vec4 p = mix(h, t, position.x);
    vec2 along = t.xy / -t.z - h.xy / -h.z;
    vec2 dir = length(along) > 1e-5 ? normalize(along) : vec2(1.0, 0.0);
    vec2 perp = vec2(-dir.y, dir.x);
    float width = uPixel * aSize * -p.z;
    p.xy += perp * position.y * width + dir * (position.x - 0.5) * 2.0 * width;

    vColor = aColor;
    vUv = position.xy;
    // Fade stars that are about to pass the camera or have just wrapped in the distance.
    vFade = smoothstep(uBoxMin.z, uBoxMin.z + 40.0, head.z) * (1.0 - smoothstep(${CAMERA_DISTANCE - 12}.0, ${CAMERA_DISTANCE - 2}.0, head.z));
    gl_Position = projectionMatrix * p;
  }
`

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying vec2 vUv;
  varying float vFade;

  void main() {
    float across = max(0.0, 1.0 - abs(vUv.y));
    float along = max(0.0, 1.0 - vUv.x * 0.8);
    float alpha = across * along * vFade;
    gl_FragColor = vec4(vColor * alpha, alpha);
  }
`

interface StarfieldProps {
  /** 0..1, how fast the ship is flying. Read every frame. */
  intensity: () => number
  reducedMotion: boolean
}

/** Warp starfield: streaks lengthen and speed up with the engaged speed level. */
export function Starfield({ intensity, reducedMotion }: StarfieldProps) {
  const size = useThree((s) => s.size)
  const speed = useRef(0)

  const geometry = useMemo(() => {
    const g = new InstancedBufferGeometry()
    g.setAttribute(
      'position',
      new Float32BufferAttribute([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0], 3),
    )
    g.setIndex([0, 1, 2, 2, 1, 3])
    const offsets = new Float32Array(COUNT * 3)
    const colors = new Float32Array(COUNT * 3)
    const sizes = new Float32Array(COUNT)
    const color = new Color()
    for (let i = 0; i < COUNT; i++) {
      offsets[i * 3] = BOX_MIN[0] + Math.random() * BOX_SIZE[0]
      offsets[i * 3 + 1] = BOX_MIN[1] + Math.random() * BOX_SIZE[1]
      offsets[i * 3 + 2] = BOX_MIN[2] + Math.random() * BOX_SIZE[2]
      // Pale, slightly tinted stars like the original's rainbow palette, a few bright ones.
      color.setHSL(Math.random(), 0.5, 0.75).multiplyScalar(0.8 + Math.random() ** 3 * 3.5)
      color.toArray(colors, i * 3)
      sizes[i] = 0.6 + Math.random() ** 2 * 1.6
    }
    g.setAttribute('aOffset', new InstancedBufferAttribute(offsets, 3))
    g.setAttribute('aColor', new InstancedBufferAttribute(colors, 3))
    g.setAttribute('aSize', new InstancedBufferAttribute(sizes, 1))
    g.instanceCount = COUNT
    return g
  }, [])

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        // The quads are expanded in screen space, so their winding varies: draw both sides.
        side: DoubleSide,
        uniforms: {
          uTravel: { value: 0 },
          uStreak: { value: 0 },
          uPixel: { value: 0 },
          uHeading: { value: HEADING },
          uBoxMin: { value: BOX_MIN },
          uBoxSize: { value: BOX_SIZE },
        },
      }),
    [],
  )

  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 0.1)
    const target = 1.5 + intensity() * (reducedMotion ? 12 : 260)
    // Spool the drive up and down smoothly instead of jumping between speeds.
    speed.current += (target - speed.current) * Math.min(1, dt * 1.6)
    const u = material.uniforms
    if (!u.uTravel || !u.uStreak || !u.uPixel) return
    u.uTravel.value += speed.current * dt
    u.uStreak.value = Math.max(0.05, speed.current * 0.035)
    // World-space width of one CSS pixel at unit distance, so streaks keep a constant width.
    const fov = 'fov' in camera ? (camera.fov as number) : 35
    u.uPixel.value = (1.15 * 2 * Math.tan((fov * Math.PI) / 360)) / size.height
  })

  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={-1} />
}
