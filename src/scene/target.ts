/**
 * Where the 3D scene currently draws the asteroid, in client pixels. The scene writes it every
 * frame so HTML overlays (hit numbers, hit points) can sit on the rock. Kept free of three.js so
 * the UI can import it without pulling in the lazily loaded scene.
 */
export const asteroidOnScreen = { x: 0, y: 0, radius: 0, visible: false }
