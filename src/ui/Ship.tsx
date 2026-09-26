import { m, useReducedMotion } from 'motion/react'
import { type MouseEvent, type Ref, useRef, useState } from 'react'
import posterUrl from '../assets/ship-poster.webp'
import { formatNumber } from '../game/format'
import { useActions } from '../game/store'
import { cn } from './cn'

export type SceneState = 'loading' | 'ready' | 'unavailable'

interface Particle {
  id: number
  x: number
  y: number
  gained: number
  critical: boolean
  driftX: number
  driftY: number
  duration: number
}

const MAX_PARTICLES = 40

interface ShipProps {
  ref: Ref<HTMLButtonElement>
  scene: SceneState
}

/**
 * The clickable ship. The 3D model is rendered by the WebGL scene behind the UI and fitted into
 * this button's box; the button itself stays a plain, keyboard-accessible control.
 */
export function Ship({ ref, scene }: ShipProps) {
  const actions = useActions()
  const reducedMotion = useReducedMotion()
  const [particles, setParticles] = useState<Particle[]>([])
  const nextId = useRef(0)

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    const { gained, critical } = actions.click()
    const rect = event.currentTarget.getBoundingClientRect()
    // Keyboard activation (detail === 0) has no pointer position: use the ship's centre.
    const fromPointer = event.detail > 0
    const particle: Particle = {
      id: nextId.current++,
      x: fromPointer ? event.clientX : rect.left + rect.width / 2,
      y: fromPointer ? event.clientY : rect.top + rect.height / 2,
      gained,
      critical,
      driftX: -(260 + Math.random() * 240),
      driftY: 180 + Math.random() * 160,
      duration: 1.5 + Math.random(),
    }
    setParticles((current) => [...current.slice(-MAX_PARTICLES + 1), particle])
  }

  const remove = (id: number) => setParticles((current) => current.filter((p) => p.id !== id))

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        aria-label="Feed the reactors: click the ship to generate energy"
        className="relative aspect-square w-[min(100cqw,100cqh,44rem)] cursor-pointer touch-manipulation rounded-full active:scale-[0.99]"
      >
        {scene === 'unavailable' && (
          <img
            src={posterUrl}
            alt=""
            draggable={false}
            className="pointer-events-none size-full object-contain"
          />
        )}
        {scene === 'loading' && (
          <span className="glow animate-pulse text-sm font-semibold tracking-widest text-white/50 uppercase">
            Spooling up reactors…
          </span>
        )}
      </button>

      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-30 overflow-hidden">
        {particles.map((p) => (
          <m.span
            key={p.id}
            className={cn(
              'glow absolute -translate-1/2 italic',
              p.critical ? 'text-7xl font-black text-energy' : 'text-3xl font-bold text-white',
            )}
            style={{ left: p.x, top: p.y }}
            initial={{ opacity: 1, x: 0, y: 0, scale: p.critical ? 0.6 : 0.8 }}
            animate={
              reducedMotion
                ? { opacity: 0 }
                : { opacity: 0, x: p.driftX, y: p.driftY, scale: p.critical ? 1.4 : 1 }
            }
            transition={{ duration: p.duration, ease: 'easeOut' }}
            onAnimationComplete={() => remove(p.id)}
          >
            +{formatNumber(p.gained)}
            {p.critical && '!'}
          </m.span>
        ))}
      </div>
    </>
  )
}
