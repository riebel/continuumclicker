import { Matrix4, Quaternion, Vector3 } from 'three'

/** Where the camera sits, looking at the origin. */
export const CAMERA_DISTANCE = 40
export const CAMERA_FOV = 35

/**
 * The ship flies towards the upper right and slightly away from the viewer, so its engines face
 * the camera: the same composition as the original 2014 artwork. The model's forward axis is +X.
 */
export const HEADING = new Vector3(0.64, 0.4, -0.66).normalize()

const up = new Vector3(0, 1, 0)
const shipUp = up
  .clone()
  .sub(HEADING.clone().multiplyScalar(HEADING.dot(up)))
  .normalize()
const side = new Vector3().crossVectors(HEADING, shipUp)

/** Rotation that turns the model (forward +X, up +Y) onto HEADING. */
export const SHIP_ORIENTATION = new Quaternion().setFromRotationMatrix(
  new Matrix4().makeBasis(HEADING, shipUp, side),
)

/**
 * Composition inside the stage box, in multiples of the box size from its centre (x right, y up,
 * depth towards the viewer): the ship sits lower left; miningField.ts composes the distant belt.
 */
export const SHIP_LAYOUT = { x: -0.1, y: -0.08, depth: 0, size: 1 }

export interface StageBox {
  /** Centre of the stage box in world units at depth 0. */
  readonly x: number
  readonly y: number
  /** Edge length of the stage box in world units at depth 0. */
  readonly size: number
}

/** Maps the stage element's box into world units on the plane through the origin. */
export function stageBox(
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  viewport: { width: number; height: number },
): StageBox {
  const visibleHeight = 2 * CAMERA_DISTANCE * Math.tan((CAMERA_FOV * Math.PI) / 360)
  const visibleWidth = (visibleHeight * viewport.width) / viewport.height
  return {
    x: ((rect.left + rect.width / 2) / viewport.width - 0.5) * visibleWidth,
    y: -((rect.top + rect.height / 2) / viewport.height - 0.5) * visibleHeight,
    size: (Math.min(rect.width, rect.height) / viewport.height) * visibleHeight,
  }
}

/**
 * World position of a layout spot. Spots in front of or behind the origin plane are pushed along
 * the camera ray, so they still appear at their place in the box.
 */
export function layoutPosition(
  box: StageBox,
  layout: { x: number; y: number; depth: number },
  out: Vector3,
): Vector3 {
  const z = layout.depth * box.size
  const perspective = (CAMERA_DISTANCE - z) / CAMERA_DISTANCE
  return out.set(
    (box.x + layout.x * box.size) * perspective,
    (box.y + layout.y * box.size) * perspective,
    z,
  )
}
