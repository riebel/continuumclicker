import { useReducedMotion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { warpIntensity } from '../game/engine'
import { gameStore } from '../game/store'

/** Initial depth of a star; it approaches the viewer until depth ≈ 0. */
const FAR = 10
/** Depth travelled per 25 ms at full stop, so the stars never freeze completely. */
const IDLE_SPEED = 0.005
/** How quickly the drive spools up or down to a new speed (ms). */
const SPOOL_MS = 700

interface Star {
  x: number
  y: number
  z: number
  /** Previous projected position, NaN right after a (re)spawn. */
  px: number
  py: number
}

function spawn(star: Star, width: number, height: number) {
  // Stars stream out of a vanishing point in the top right, the ship's heading.
  star.x = (Math.random() * 1.3 - 1.2) * width * FAR
  star.y = (Math.random() * 1.3 - 0.1) * height * FAR
  star.z = FAR
  star.px = Number.NaN
  star.py = Number.NaN
}

/** Classic warp-speed starfield on a canvas behind the game. Speed follows the engaged level. */
export function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reducedMotion = useReducedMotion() ?? false

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    let width = 0
    let height = 0
    let stars: Star[] = []

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)

      const count = Math.round(Math.min(1000, (width * height) / 1500))
      stars = Array.from({ length: count }, () => {
        const star = { x: 0, y: 0, z: 0, px: 0, py: 0 }
        spawn(star, width, height)
        star.z = Math.random() * FAR
        return star
      })
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    let speed = IDLE_SPEED
    let phase = 0
    let last = performance.now()
    let frame = 0

    const draw = (now: number) => {
      const dt = Math.min(now - last, 100)
      last = now

      const intensity = warpIntensity(gameStore.getState().game)
      const target = Math.max(IDLE_SPEED, reducedMotion ? intensity * 0.08 : intensity)
      speed += (target - speed) * Math.min(1, dt / SPOOL_MS)
      const step = speed * (dt / 25)

      const cx = width * 0.97
      const cy = height * 0.05

      context.globalAlpha = 1
      context.fillStyle = '#05060f'
      context.fillRect(0, 0, width, height)
      context.globalAlpha = 0.45
      context.lineCap = 'round'

      for (let i = 0; i < stars.length; i++) {
        const star = stars[i] as Star
        star.z -= step
        if (star.z <= step) {
          spawn(star, width, height)
          continue
        }

        const sx = star.x / star.z + cx
        const sy = star.y / star.z + cy
        if (sx < -50 || sy > height + 50 || sx > width + 50 || sy < -50) {
          spawn(star, width, height)
          continue
        }

        if (!Number.isNaN(star.px)) {
          const r = Math.sin(0.3 * i + phase) * 64 + 190
          const g = Math.sin(0.3 * i + 2 + phase) * 64 + 190
          const b = Math.sin(0.3 * i + 4 + phase) * 64 + 190
          context.strokeStyle = `rgb(${r | 0} ${g | 0} ${b | 0})`
          context.lineWidth = 5 / star.z + 0.6
          context.beginPath()
          context.moveTo(star.px, star.py)
          context.lineTo(sx, sy)
          context.stroke()
        }
        star.px = sx
        star.py = sy
      }

      phase += reducedMotion ? 0 : dt * 0.004
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [reducedMotion])

  return (
    <div aria-hidden="true" className="fixed inset-0">
      <canvas ref={canvasRef} className="size-full" />
    </div>
  )
}
