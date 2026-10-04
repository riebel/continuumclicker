import { Environment, Lightformer, PerformanceMonitor } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { type RefObject, Suspense, useEffect, useState } from 'react'
import { Vector3 } from 'three'
import { warpIntensity } from '../game/engine'
import { gameStore } from '../game/store'
import { CAMERA_DISTANCE, CAMERA_FOV } from './constants'
import { Mining } from './Mining'
import { Ship } from './Ship'
import { Starfield } from './Starfield'
import { createWeaponMuzzles } from './weaponMounts'

const intensity = () => warpIntensity(gameStore.getState().game)

function Ready({ onReady }: { onReady: () => void }) {
  useEffect(() => onReady(), [onReady])
  return null
}

export interface ShipSceneProps {
  anchor: RefObject<HTMLElement | null>
  reducedMotion: boolean
  onReady: () => void
}

/**
 * Full-screen WebGL layer behind the UI: warp starfield, the modular 3D ship, the asteroid it
 * mines and HDR bloom.
 * Engine glow comes from emissive materials and exhaust shaders above 1.0 that bloom picks up.
 */
export default function ShipScene({ anchor, reducedMotion, onReady }: ShipSceneProps) {
  // Lower the resolution on devices that cannot keep up, raise it again when they can.
  const [maxDpr, setMaxDpr] = useState(1.75)
  const [bow] = useState(() => new Vector3())
  const [target] = useState(() => new Vector3())
  const [collector] = useState(() => new Vector3())
  const [muzzles] = useState(createWeaponMuzzles)
  return (
    <Canvas
      flat
      dpr={[1, maxDpr]}
      camera={{ position: [0, 0, CAMERA_DISTANCE], fov: CAMERA_FOV, near: 1, far: 400 }}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      eventSource={document.body}
      eventPrefix="client"
      className="!fixed inset-0"
      aria-hidden="true"
    >
      <PerformanceMonitor
        flipflops={3}
        onDecline={() => setMaxDpr(1)}
        onIncline={() => setMaxDpr(1.75)}
        onFallback={() => setMaxDpr(1)}
      />
      <color attach="background" args={['#05060f']} />
      <Starfield intensity={intensity} reducedMotion={reducedMotion} />

      <ambientLight intensity={0.25} color="#8fa3d9" />
      <directionalLight position={[14, 18, 20]} intensity={3.4} color="#e4ecff" />
      <directionalLight position={[-20, 4, -14]} intensity={3.5} color="#7c95ff" />
      <Environment resolution={128} frames={1}>
        <Lightformer
          form="rect"
          intensity={1.6}
          color="#c9d6ff"
          position={[0, 10, 8]}
          scale={[24, 6, 1]}
        />
        <Lightformer
          form="rect"
          intensity={0.6}
          color="#e0d6c8"
          position={[-12, -6, 10]}
          scale={[12, 4, 1]}
        />
        <Lightformer
          form="ring"
          intensity={2.2}
          color="#9db4ff"
          position={[12, 4, -10]}
          scale={8}
        />
      </Environment>

      <Suspense fallback={null}>
        <Ship
          anchor={anchor}
          bow={bow}
          target={target}
          collector={collector}
          muzzles={muzzles}
          reducedMotion={reducedMotion}
        />
        <Mining
          anchor={anchor}
          bow={bow}
          target={target}
          collector={collector}
          muzzles={muzzles}
          reducedMotion={reducedMotion}
        />
        <Ready onReady={onReady} />
      </Suspense>

      <EffectComposer multisampling={4}>
        <Bloom
          mipmapBlur
          luminanceThreshold={1}
          luminanceSmoothing={0.3}
          intensity={1.15}
          radius={0.72}
        />
        <ToneMapping mode={ToneMappingMode.AGX} />
      </EffectComposer>
    </Canvas>
  )
}
