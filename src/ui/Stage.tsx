import { m, useReducedMotion } from 'motion/react'
import {
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import posterUrl from '../assets/ship-poster.webp'
import { ASTEROIDS, LASER } from '../game/content'
import type { Asteroid, CometReward } from '../game/engine'
import { formatNumber } from '../game/format'
import { gameStore, useActions, useGame } from '../game/store'
import { asteroidOnScreen } from '../scene/target'
import { Comet } from './Comet'
import { cn } from './cn'

export type SceneState = 'loading' | 'ready' | 'unavailable'

type Tone = 'hit' | 'crit' | 'crystal' | 'bonus' | 'comet' | 'special'

interface Popup {
  id: number
  x: number
  y: number
  text: string
  tone: Tone
  driftX: number
  driftY: number
  duration: number
}

const MAX_POPUPS = 40

const TONES: Record<Tone, string> = {
  special: 'text-sm font-bold tracking-widest text-crystal uppercase whitespace-nowrap not-italic',
  hit: 'text-2xl font-bold text-white',
  crystal: 'text-3xl font-bold text-crystal',
  crit: 'text-5xl font-black text-energy',
  bonus: 'text-4xl font-black text-energy',
  comet: 'w-72 text-center text-2xl font-black text-sky-200 not-italic sm:text-3xl',
}

function describeReward(reward: CometReward): string {
  switch (reward.kind) {
    case 'overdrive':
      return `Overdrive! Reactors ×${reward.multiplier} for ${reward.duration} s`
    case 'laser-frenzy':
      return `Laser frenzy! Hits ×${reward.multiplier} for ${reward.duration} s`
    case 'windfall':
      return `Windfall! +${formatNumber(reward.energy)}`
  }
}

/** Where the asteroid is drawn: from the 3D scene, or a fixed spot in the stage without WebGL. */
function asteroidPosition(stage: HTMLElement | null) {
  if (asteroidOnScreen.visible) return asteroidOnScreen
  const rect = stage?.getBoundingClientRect()
  if (!rect) return { x: 0, y: 0, radius: 0 }
  const size = Math.min(rect.width, rect.height)
  return {
    x: rect.left + rect.width / 2 + size * 0.1,
    y: rect.top + rect.height / 2 - size * 0.36,
    radius: size * 0.064,
  }
}

/** Hit points of the targeted asteroid, following it on screen. */
function AsteroidStatus({
  stage,
  scene,
}: {
  stage: RefObject<HTMLElement | null>
  scene: SceneState
}) {
  const gameTarget = useGame((s) => s.game.asteroid)
  const [visibleTarget, setVisibleTarget] = useState<Asteroid | null>(null)
  const { hp, maxHp, kind } = scene === 'ready' && visibleTarget ? visibleTarget : gameTarget
  const box = useRef<HTMLDivElement>(null)
  const reticle = useRef<HTMLDivElement>(null)
  const status = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let last = ''
    let frame = requestAnimationFrame(function follow() {
      if (scene === 'ready' && asteroidOnScreen.visible && asteroidOnScreen.hp >= 0) {
        const { hp, maxHp, kind } = asteroidOnScreen
        const key = `${hp}:${maxHp}:${kind}`
        if (key !== last) {
          last = key
          setVisibleTarget({ hp, maxHp, kind })
        }
      }
      const { x, y, radius } = asteroidPosition(stage.current)
      if (box.current) box.current.style.transform = `translate(${x}px, ${y}px)`
      if (reticle.current) {
        reticle.current.style.width = `${radius * 2.7}px`
        reticle.current.style.height = `${radius * 2.7}px`
      }
      if (status.current) status.current.style.transform = `translate(-50%, ${radius * 1.5}px)`
      frame = requestAnimationFrame(follow)
    })
    return () => cancelAnimationFrame(frame)
  }, [stage, scene])

  const crystal = kind === 'crystal'
  return (
    <div
      ref={box}
      data-testid="asteroid-status"
      className="pointer-events-none fixed top-0 left-0 z-20 size-0"
      aria-hidden="true"
    >
      {scene === 'ready' && (
        <div ref={reticle} className="absolute top-0 left-0 -translate-1/2 text-crystal/60">
          <span className="absolute top-0 left-0 size-3 border-t border-l" />
          <span className="absolute top-0 right-0 size-3 border-t border-r" />
          <span className="absolute bottom-0 left-0 size-3 border-b border-l" />
          <span className="absolute bottom-0 right-0 size-3 border-b border-r" />
        </div>
      )}
      <div
        ref={status}
        className="absolute top-0 left-0 flex w-max flex-col items-center gap-1 text-center"
      >
        {scene === 'unavailable' && (
          <span
            className={cn(
              'mb-1 size-16 -translate-y-24 rounded-[45%_55%_50%_50%] shadow-inner',
              crystal ? 'bg-cyan-900 ring-2 ring-crystal' : 'bg-stone-600',
            )}
          />
        )}
        <span className="flex gap-0.5">
          {Array.from({ length: maxHp }, (_, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length pips
              key={i}
              className={cn(
                'h-1 w-2.5 rounded-full transition-colors',
                i < hp ? (crystal ? 'bg-crystal' : 'bg-burst') : 'bg-white/15',
              )}
            />
          ))}
        </span>
        <span className="whitespace-nowrap text-[9px] font-semibold tracking-[0.2em] text-white/45 uppercase">
          Target locked
        </span>
        {crystal && (
          <span className="glow text-xs font-bold tracking-widest text-crystal uppercase">
            Crystal ×{ASTEROIDS.crystal.energyMultiplier}
          </span>
        )}
      </div>
    </div>
  )
}

/** A fixed bonus control; the normal firing surface also strikes this lock automatically. */
function CrystalVein({
  stage,
  onStrike,
}: {
  stage: RefObject<HTMLElement | null>
  onStrike(): void
}) {
  const vein = useGame((s) => s.vein)
  const box = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!vein) return
    let frame = requestAnimationFrame(function follow() {
      const rect = stage.current?.getBoundingClientRect()
      if (box.current && rect)
        box.current.style.transform = `translate(${rect.left + rect.width * 0.5}px, ${rect.top + rect.height * 0.83}px)`
      frame = requestAnimationFrame(follow)
    })
    return () => cancelAnimationFrame(frame)
  }, [stage, vein])

  if (!vein) return null
  return (
    <button
      key={vein.id}
      ref={box}
      type="button"
      aria-label="Strike the crystal vein for a critical hit"
      onPointerDown={(event) => {
        event.stopPropagation()
        onStrike()
      }}
      onClick={(event) => event.detail === 0 && onStrike()}
      className="fixed top-0 left-0 z-30 -mt-6 -ml-6 grid size-12 cursor-pointer touch-manipulation place-items-center"
    >
      <span className="absolute size-9 animate-ping rounded-full bg-crystal/40" />
      <span className="size-4 rotate-45 bg-crystal shadow-[0_0_12px_4px_var(--color-crystal)]" />
    </button>
  )
}

interface StageProps {
  ref: RefObject<HTMLButtonElement | null>
  scene: SceneState
}

/**
 * The play area. The 3D ship and asteroid are rendered by the WebGL scene behind the UI and
 * fitted into this button's box; the button itself stays a plain, keyboard-accessible control.
 * Click or tap to fire the mining laser, hold to keep firing.
 */
export function Stage({ ref, scene }: StageProps) {
  const actions = useActions()
  const reducedMotion = useReducedMotion()
  const crystalLock = useGame((s) => s.vein !== null)
  const [popups, setPopups] = useState<Popup[]>([])
  const nextId = useRef(0)
  const autoFire = useRef<number | undefined>(undefined)

  const show = (...added: Popup[]) =>
    setPopups((current) => [...current.slice(-MAX_POPUPS + added.length), ...added])

  const shoot = (options?: { vein?: boolean }) => {
    const shot = actions.fire({ vein: options?.vein ?? gameStore.getState().vein !== null })
    const { x, y, radius } = asteroidPosition(ref.current)
    const popup = (amount: number, tone: Tone): Popup => ({
      id: nextId.current++,
      x: x + (Math.random() - 0.5) * radius * 1.2,
      y: y - radius * 0.2,
      text: `+${formatNumber(amount)}${tone === 'crit' ? '!' : ''}`,
      tone,
      driftX: (Math.random() - 0.5) * 120,
      driftY: -(110 + Math.random() * 90),
      duration: tone === 'bonus' ? 1.8 : 1.1 + Math.random() * 0.4,
    })
    const tone = shot.critical ? 'crit' : shot.target.kind === 'crystal' ? 'crystal' : 'hit'
    const added = [popup(shot.gained, tone)]
    if (shot.bonus > 0) added.push({ ...popup(shot.bonus, 'bonus'), x, driftX: 0 })
    if (shot.special)
      added.push({
        ...popup(0, 'crystal'),
        text: shot.special,
        x,
        y: y - radius - 20,
        driftX: 0,
        duration: 1,
        tone: 'special',
      })
    show(...added)
  }

  const onCometCaught = (reward: CometReward, x: number, y: number) => {
    // Keep the message on screen even when the comet was caught at the very edge.
    const clampedX = Math.min(Math.max(x, 150), window.innerWidth - 150)
    show({
      id: nextId.current++,
      x: clampedX,
      y,
      text: describeReward(reward),
      tone: 'comet',
      driftX: 0,
      driftY: -70,
      duration: 2.6,
    })
  }

  const stopFiring = () => {
    clearInterval(autoFire.current)
    autoFire.current = undefined
  }
  useEffect(() => {
    const stop = () => {
      clearInterval(autoFire.current)
      autoFire.current = undefined
    }
    window.addEventListener('blur', stop)
    return () => {
      window.removeEventListener('blur', stop)
      stop()
    }
  }, [])

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Not every environment supports capture; releasing outside then just ends the burst.
    }
    shoot()
    stopFiring()
    autoFire.current = window.setInterval(() => shoot(), 1000 / LASER.autoFireRate)
  }

  // Pointer shots fire on press; this only handles keyboard activation (Enter / Space).
  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0) shoot()
  }

  const remove = (id: number) => setPopups((current) => current.filter((p) => p.id !== id))

  return (
    <>
      <button
        ref={ref}
        type="button"
        onPointerDown={onPointerDown}
        onPointerUp={stopFiring}
        onPointerCancel={stopFiring}
        onLostPointerCapture={stopFiring}
        onClick={onClick}
        onContextMenu={(event) => event.preventDefault()}
        aria-label="Fire the mining laser at the asteroid (hold to keep firing)"
        className="relative aspect-square w-[min(100cqw,100cqh,44rem)] cursor-crosshair touch-manipulation rounded-full"
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
        {scene !== 'loading' && (
          <span className="pointer-events-none absolute right-0 bottom-[8%] left-0 text-center text-[10px] font-semibold tracking-[0.17em] text-white/45 uppercase">
            {crystalLock
              ? 'Crystal lock · next hit critical'
              : 'Auto target · click or hold to fire'}
          </span>
        )}
      </button>

      {createPortal(
        <>
          {scene !== 'loading' && (
            <>
              <AsteroidStatus stage={ref} scene={scene} />
              <CrystalVein stage={ref} onStrike={() => shoot({ vein: true })} />
            </>
          )}
          <Comet onCaught={onCometCaught} />

          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 z-30 overflow-hidden"
          >
            {popups.map((p) => (
              <m.span
                key={p.id}
                className={cn('glow absolute -translate-1/2 italic tabular-nums', TONES[p.tone])}
                style={{ left: p.x, top: p.y }}
                initial={{ opacity: 1, x: 0, y: 0, scale: p.tone === 'crit' ? 0.6 : 0.8 }}
                animate={
                  reducedMotion
                    ? { opacity: 0 }
                    : {
                        opacity: [1, 1, 0],
                        x: p.driftX,
                        y: p.driftY,
                        scale: p.tone === 'crit' || p.tone === 'bonus' ? 1.25 : 1,
                      }
                }
                transition={{ duration: p.duration, ease: 'easeOut' }}
                onAnimationComplete={() => remove(p.id)}
              >
                {p.text}
              </m.span>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  )
}
