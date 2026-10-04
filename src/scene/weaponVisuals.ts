import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
} from 'three'

export const beamGeometry = new CylinderGeometry(1, 1, 1, 16, 8, true)
export const flashGeometry = new PlaneGeometry(1, 1)

/** View-dependent soft volume: a narrow hot core surrounded by a fading coloured envelope. */
export function beamMaterial(color: string, trail = false) {
  const uniforms = {
    uColor: { value: new Color(color) },
    uOpacity: { value: 0 },
    uTime: { value: 0 },
    uTrail: { value: trail ? 1 : 0 },
  }
  return Object.assign(
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms,
      vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vAlong;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = -view.xyz;
        vAlong = position.y + 0.5;
        gl_Position = projectionMatrix * view;
      }
    `,
      fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      uniform float uTrail;
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vAlong;
      void main() {
        float along = clamp(vAlong, 0.0, 1.0);
        float facing = abs(dot(normalize(vNormal), normalize(vView)));
        float halo = pow(facing, 1.8);
        float core = pow(facing, 9.0);
        float endFade = smoothstep(0.0, 0.007, along) * smoothstep(0.0, 0.007, 1.0 - along);
        float wake = mix(endFade, pow(along, 1.8), uTrail);
        float ripple = 0.96 + 0.04 * sin(along * 45.0 - uTime * 80.0);
        vec3 light = uColor * halo * 1.1 + mix(uColor, vec3(1.0, 0.94, 0.84), 0.78) * core * 3.5;
        gl_FragColor = vec4(light * wake * ripple * uOpacity, 1.0);
      }
    `,
    }),
    { uniforms },
  )
}

/** Procedural radiance, no bitmap rings: a brief hot flash decaying into turbulent wisps. */
export function flashMaterial(color: string, lens = false) {
  const uniforms = {
    uColor: { value: new Color(color) },
    uAge: { value: 10 },
    uLens: { value: lens ? 1 : 0 },
    uOpacity: { value: 1 },
  }
  return Object.assign(
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: lens ? NormalBlending : AdditiveBlending,
      uniforms,
      vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
      fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uAge;
      uniform float uLens;
      uniform float uOpacity;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
      }
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        float age = max(0.0, uAge);
        if (uLens > 0.5) {
          float collapse = sin(clamp(age / 0.55, 0.0, 1.0) * 3.14159);
          float radius = 0.28 + 0.16 * collapse;
          float angle = atan(p.y, p.x);
          float orbit = exp(-pow((r-radius) * 30.0, 2.0));
          float filaments = pow(max(0.0, sin(angle * 5.0 + age * 9.0 + r * 22.0)), 3.0);
          float edge = orbit * (0.22 + 0.75 * filaments) * collapse;
          float silhouette = (1.0-smoothstep(radius-0.02, radius, r)) * collapse;
          gl_FragColor = vec4(uColor * edge * 3.0 + vec3(0.002,0.001,0.008), clamp(silhouette + edge, 0.0, 1.0) * uOpacity);
        } else {
          float hot = exp(-r*r*65.0) * exp(-age*36.0);
          float fog = exp(-r*r*9.0) * exp(-age*13.0);
          float wisps = noise(p*9.0 + vec2(age*6.0, -age*3.0));
          vec3 radiance = vec3(1.0,0.94,0.82) * hot * 7.0 + uColor * fog * (0.25 + wisps*0.4);
          gl_FragColor = vec4(radiance * uOpacity, 1.0);
        }
      }
    `,
    }),
    { uniforms },
  )
}
