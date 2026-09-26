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
