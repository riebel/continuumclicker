import { m } from 'motion/react'
import type { MouseEvent, PointerEvent } from 'react'
import type { CometReward } from '../game/engine'
import { mulberry32 } from '../game/random'
import { type Comet as CometEvent, useActions, useGame } from '../game/store'

/** A path across the viewport, in fractions of its size, seeded by the comet's id. */
function flightPath(id: number) {
  const random = mulberry32(id * 2654435761)
  const fromLeft = random() < 0.5
  const y0 = 0.12 + random() * 0.3
  const y1 = y0 + (random() - 0.35) * 0.35
  return {
    from: { x: fromLeft ? -0.08 : 1.08, y: y0 },
    to: { x: fromLeft ? 1.08 : -0.08, y: y1 },
  }
}

interface CometProps {
  /** Called with the reward and the client position where the comet was caught. */
  onCaught(reward: CometReward, x: number, y: number): void
}

/**
 * A comet drifting across the screen. Catching it (click, tap or keyboard) grants a random
 * reward; it only appears while the game is open.
 */
export function Comet({ onCaught }: CometProps) {
  const comet = useGame((s) => s.comet)
  if (!comet) return null
  return <FlyingComet key={comet.id} comet={comet} onCaught={onCaught} />
}

function FlyingComet({ comet, onCaught }: CometProps & { comet: CometEvent }) {
  const { catchComet } = useActions()
  const { from, to } = flightPath(comet.id)
  const width = window.innerWidth
  const height = window.innerHeight
  const lifetime = (comet.leavesAt - comet.appearedAt) / 1000
  const elapsed = Math.min(lifetime, Math.max(0, (Date.now() - comet.appearedAt) / 1000))
  const at = (t: number) => ({
    x: (from.x + (to.x - from.x) * t) * width,
    y: (from.y + (to.y - from.y) * t) * height,
  })
  const start = at(elapsed / lifetime)
  const end = at(1)
  // The tail points away from the direction of flight.
  const angle = Math.atan2(end.y - start.y, end.x - start.x)

  const collect = (x: number, y: number) => {
    const reward = catchComet()
    if (reward) onCaught(reward, x, y)
  }
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    collect(event.clientX, event.clientY)
  }
  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail !== 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    collect(rect.left + rect.width / 2, rect.top + rect.height / 2)
  }

  return (
    <m.button
      type="button"
      aria-label="Catch the comet"
      onPointerDown={onPointerDown}
      onClick={onClick}
      className="fixed top-0 left-0 z-40 -mt-8 -ml-8 size-16 cursor-pointer touch-manipulation rounded-full"
      initial={{ x: start.x, y: start.y, opacity: 0 }}
      animate={{ x: end.x, y: end.y, opacity: 1 }}
      transition={{
        x: { duration: lifetime - elapsed, ease: 'linear' },
        y: { duration: lifetime - elapsed, ease: 'linear' },
        opacity: { duration: 0.6 },
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 h-3 w-40 origin-left -translate-y-1/2 rounded-full bg-gradient-to-r from-sky-100/80 via-sky-300/25 to-transparent blur-[2px]"
        style={{ transform: `rotate(${angle + Math.PI}rad)` }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-4 animate-pulse rounded-full bg-white shadow-[0_0_14px_6px_rgb(186_230_253/0.9),0_0_40px_16px_rgb(56_189_248/0.45)]"
      />
    </m.button>
  )
}
