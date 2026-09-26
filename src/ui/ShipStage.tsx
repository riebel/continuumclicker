import { useReducedMotion } from 'motion/react'
import { Component, lazy, type ReactNode, type RefObject, Suspense } from 'react'

const ShipScene = lazy(() => import('../scene/ShipScene'))

/** True when the browser can create a WebGL 2 context. */
export function supportsWebGL(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

class SceneBoundary extends Component<
  { onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch(error: unknown) {
    console.warn('3D scene unavailable, falling back to a still image.', error)
    this.props.onError()
  }

  override render() {
    return this.state.failed ? null : this.props.children
  }
}

interface ShipStageProps {
  anchor: RefObject<HTMLElement | null>
  onReady: () => void
  onUnavailable: () => void
}

/** Lazily loads the WebGL scene so the game UI is interactive before three.js arrives. */
export function ShipStage({ anchor, onReady, onUnavailable }: ShipStageProps) {
  const reducedMotion = useReducedMotion() ?? false
  return (
    <SceneBoundary onError={onUnavailable}>
      <Suspense fallback={null}>
        <ShipScene anchor={anchor} reducedMotion={reducedMotion} onReady={onReady} />
      </Suspense>
    </SceneBoundary>
  )
}
