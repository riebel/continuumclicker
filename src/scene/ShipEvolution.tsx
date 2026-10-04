import { useFrame } from '@react-three/fiber'
import { type RefObject, useEffect, useMemo, useRef } from 'react'
import { ExtrudeGeometry, type Group, type Object3D, Shape } from 'three'
import { WEAPONS } from '../game/content'
import { shipForm } from '../game/engine'
import { gameStore, useGame } from '../game/store'

const SIDES = [-1, 1] as const
const METAL = '#52627e'
const DARK = '#182337'

/** Large swept fins change the silhouette even at the first upgrade. Units are ship lengths. */
function Wing({ side, heavy = false }: { side: number; heavy?: boolean }) {
  const geometry = useMemo(() => {
    const shape = new Shape()
    shape.moveTo(-0.32, 0.07 * side)
    shape.lineTo(-0.42, (heavy ? 0.5 : 0.31) * side)
    shape.lineTo(-0.13, (heavy ? 0.45 : 0.29) * side)
    shape.lineTo(0.15, 0.08 * side)
    shape.closePath()
    const geometry = new ExtrudeGeometry(shape, {
      depth: heavy ? 0.035 : 0.018,
      bevelEnabled: true,
      bevelSize: 0.006,
      bevelThickness: 0.004,
      bevelSegments: 1,
      steps: 1,
    })
    geometry.rotateX(Math.PI / 2)
    return geometry
  }, [side, heavy])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color={heavy ? METAL : DARK} metalness={0.8} roughness={0.38} />
    </mesh>
  )
}

function Block({
  position,
  scale,
  glow = false,
  color = METAL,
}: {
  position: [number, number, number]
  scale: [number, number, number]
  glow?: boolean
  color?: string
}) {
  return (
    <mesh position={position} scale={scale}>
      <boxGeometry />
      <meshStandardMaterial
        color={color}
        metalness={0.75}
        roughness={0.3}
        emissive={glow ? color : '#000000'}
        emissiveIntensity={glow ? 2.5 : 0}
      />
    </mesh>
  )
}

function Pod({ side, capital = false }: { side: number; capital?: boolean }) {
  const z = side * (capital ? 0.43 : 0.27)
  const radius = capital ? 0.06 : 0.038
  return (
    <group position={[-0.24, capital ? 0.045 : -0.055, z]}>
      {[-0.09, 0, 0.09].map((x) => (
        <mesh key={x} position={[x, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[radius * 1.02, radius * 0.1, 4, 12]} />
          <meshStandardMaterial color={DARK} metalness={0.85} roughness={0.45} />
        </mesh>
      ))}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[radius * 0.8, radius, capital ? 0.36 : 0.27, 8]} />
        <meshStandardMaterial color={METAL} metalness={0.85} roughness={0.32} />
      </mesh>
      <Block
        position={[0, radius, 0]}
        scale={[capital ? 0.26 : 0.2, 0.007, 0.013]}
        color="#5ee7ff"
        glow
      />
      <mesh position={[-(capital ? 0.19 : 0.145), 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[radius * 0.72, radius * 0.72, 0.014, 12]} />
        <meshBasicMaterial color={[1, 3.5, 6]} toneMapped={false} />
      </mesh>
      <mesh position={[-(capital ? 0.27 : 0.21), 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[radius * 0.68, capital ? 0.16 : 0.12, 12]} />
        <meshBasicMaterial
          color={[0.3, 1.2, 3]}
          transparent
          opacity={0.5}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

function WeaponMount({ muzzle }: { muzzle: RefObject<Object3D | null> }) {
  const active = useGame((s) => s.game.activeWeapon)
  const level = useGame((s) => s.game.weapons[s.game.activeWeapon])
  const weapon = WEAPONS.find((w) => w.id === active) ?? WEAPONS[0]
  const mount = useRef<Group>(null)
  const shotId = useRef(0)
  const firedAt = useRef(-1000)
  useFrame(() => {
    if (!mount.current) return
    const shot = gameStore.getState().lastShot
    mount.current.position.x =
      0.3 -
      (shot && shot.id > 0
        ? Math.max(0, 0.015 - (performance.now() - firedAt.current) * 0.0001)
        : 0)
    if (shot && shot.id !== shotId.current) {
      shotId.current = shot.id
      firedAt.current = performance.now()
    }
  })
  return (
    <group ref={mount} position={[0.3, 0.07, 0]} scale={1 + (level - 1) * 0.08}>
      <object3D ref={muzzle} position={[active === 'railgun' ? 0.22 : 0.17, 0, 0]} />
      <Block position={[0, 0, 0]} scale={[0.11, 0.07, 0.11]} color={DARK} />
      {active === 'swarm' ? (
        SIDES.flatMap((side) =>
          [0, 1, 2].map((i) => (
            <Block
              key={`${side}-${i}`}
              position={[0.06, i * 0.025 - 0.025, side * 0.036]}
              scale={[0.15, 0.017, 0.02]}
              color={weapon.color}
              glow
            />
          )),
        )
      ) : active === 'tesla' ? (
        SIDES.map((side) => (
          <group key={side} position={[0.035, 0, side * 0.055]}>
            <Block position={[0.035, 0, 0]} scale={[0.16, 0.018, 0.018]} color={METAL} />
            <mesh position={[0.12, 0, 0]}>
              <sphereGeometry args={[0.025, 12, 8]} />
              <meshStandardMaterial
                color={weapon.color}
                emissive={weapon.color}
                emissiveIntensity={3}
              />
            </mesh>
          </group>
        ))
      ) : active === 'singularity' ? (
        <mesh position={[0.1, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[0.065, 0.013, 8, 32]} />
          <meshStandardMaterial
            color={weapon.color}
            emissive={weapon.color}
            emissiveIntensity={3}
          />
        </mesh>
      ) : (
        <>
          {SIDES.map((side) => (
            <Block
              key={side}
              position={[0.09, 0, side * 0.035]}
              scale={[active === 'railgun' ? 0.26 : 0.16, 0.022, 0.018]}
              color={METAL}
            />
          ))}
          <Block
            position={[0.11, 0, 0]}
            scale={[active === 'railgun' ? 0.26 : 0.16, 0.018, 0.027]}
            color={weapon.color}
            glow
          />
        </>
      )}
    </group>
  )
}

/** Six substantial hull refits deploy smoothly around the existing detailed glTF hull. */
export function ShipEvolution({
  length,
  muzzle,
  reducedMotion,
}: {
  length: number
  muzzle: RefObject<Object3D | null>
  reducedMotion: boolean
}) {
  const ref = useRef<Group>(null)
  const stages = useRef<number[]>(Array(6).fill(-1))
  useFrame((_, delta) => {
    if (!ref.current) return
    const form = shipForm(gameStore.getState().game)
    ref.current.children.slice(0, 6).forEach((group, i) => {
      const target = form > i ? 1 : 0
      const previous = stages.current[i] ?? -1
      const k =
        reducedMotion || previous < 0
          ? target
          : previous + (target - previous) * Math.min(1, delta * 3)
      stages.current[i] = k
      group.visible = k > 0.005
      group.scale.setScalar(Math.max(0.001, k))
      group.rotation.x = (1 - k) * (i % 2 ? -0.65 : 0.65)
      group.position.y = (1 - k) * 0.15
    })
  })

  return (
    <group ref={ref} scale={length}>
      <group>
        {SIDES.map((side) => (
          <group key={side}>
            <Wing side={side} />
            <Pod side={side} />
          </group>
        ))}
      </group>
      <group>
        {SIDES.map((side) => (
          <group key={side}>
            <Block position={[0.2, 0.04, side * 0.11]} scale={[0.33, 0.09, 0.045]} />
            <Block
              position={[0.21, 0.09, side * 0.11]}
              scale={[0.28, 0.009, 0.012]}
              color="#5ee7ff"
              glow
            />
            <Block position={[-0.29, 0.05, side * 0.15]} scale={[0.38, 0.1, 0.05]} />
          </group>
        ))}
      </group>
      <group>
        {SIDES.map((side) => (
          <group key={side}>
            <Wing side={side} heavy />
            <Pod side={side} capital />
          </group>
        ))}
        <mesh position={[-0.14, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[0.17, 0.011, 8, 48]} />
          <meshStandardMaterial
            color="#5ee7ff"
            emissive="#5ee7ff"
            emissiveIntensity={2}
            metalness={0.6}
          />
        </mesh>
      </group>
      <group>
        <Block position={[-0.08, 0.17, 0]} scale={[0.24, 0.15, 0.11]} color={DARK} />
        <Block position={[-0.025, 0.25, 0]} scale={[0.14, 0.035, 0.17]} />
        <Block position={[0.047, 0.248, 0]} scale={[0.008, 0.016, 0.14]} color="#5ee7ff" glow />
        {SIDES.map((side) => (
          <Block key={side} position={[-0.05, -0.07, side * 0.2]} scale={[0.45, 0.11, 0.08]} />
        ))}
      </group>
      <group>
        {SIDES.map((side) => (
          <group key={side}>
            <Block position={[0.16, 0.14, side * 0.19]} scale={[0.62, 0.045, 0.045]} color={DARK} />
            <Block
              position={[0.16, 0.166, side * 0.19]}
              scale={[0.58, 0.01, 0.012]}
              color="#bb8bff"
              glow
            />
            <Block position={[-0.24, 0.08, side * 0.38]} scale={[0.3, 0.065, 0.12]} />
          </group>
        ))}
      </group>
      <group>
        {[-0.3, -0.1].map((x) => (
          <mesh key={x} position={[x, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
            <torusGeometry args={[0.255, 0.018, 8, 48]} />
            <meshStandardMaterial color="#798bff" emissive="#798bff" emissiveIntensity={2.8} />
          </mesh>
        ))}
        {SIDES.map((side) => (
          <group key={side} position={[0.03, -0.1, side * 0.06]}>
            <Pod side={side} capital />
          </group>
        ))}
      </group>
      <WeaponMount muzzle={muzzle} />
    </group>
  )
}
