import { useEffect } from 'react'
import { useActions } from '../game/store'

export const AUTOSAVE_INTERVAL_MS = 15_000

/**
 * Drives the simulation once per animation frame and persists the game regularly and whenever
 * the page is hidden or closed. Browsers pause animation frames in background tabs; the next
 * tick then catches up exactly, so no progress is lost.
 */
export function useGameLoop() {
  const actions = useActions()

  useEffect(() => {
    let frame = requestAnimationFrame(function loop() {
      actions.tick()
      frame = requestAnimationFrame(loop)
    })
    const autosave = setInterval(() => actions.save(), AUTOSAVE_INTERVAL_MS)
    const saveWhenHidden = () => {
      if (document.visibilityState === 'hidden') actions.save()
    }
    const saveNow = () => actions.save()

    document.addEventListener('visibilitychange', saveWhenHidden)
    window.addEventListener('pagehide', saveNow)
    return () => {
      cancelAnimationFrame(frame)
      clearInterval(autosave)
      document.removeEventListener('visibilitychange', saveWhenHidden)
      window.removeEventListener('pagehide', saveNow)
    }
  }, [actions])
}
