/**
 * The soft shapes the enterprise scene draws its light with.
 *
 * The nebula is built once in the browser rather than loaded: a texture file
 * for a radial gradient would be a network round trip for something four lines
 * of canvas describe exactly.
 */

import { CanvasTexture, type Texture } from 'three'

/** Edge length of the generated nebula texture, in pixels. */
const NEBULA_SIZE = 128

/**
 * A round, soft, centre-bright gradient for the division nebulae.
 *
 * The falloff is cubic rather than linear so the sprite has no visible rim at
 * its edge, which is what lets ten of them overlap without reading as discs.
 * @returns A texture owned by the caller, which disposes it.
 */
export function createNebulaTexture(): Texture {
  const canvas = document.createElement('canvas')
  canvas.width = NEBULA_SIZE
  canvas.height = NEBULA_SIZE
  const context = canvas.getContext('2d')
  if (context !== null) {
    const half = NEBULA_SIZE / 2
    const image = context.createImageData(NEBULA_SIZE, NEBULA_SIZE)
    for (let y = 0; y < NEBULA_SIZE; y++) {
      for (let x = 0; x < NEBULA_SIZE; x++) {
        const distance = Math.hypot(x + 0.5 - half, y + 0.5 - half) / half
        const fade = distance >= 1 ? 0 : (1 - distance) ** 3
        const offset = ((y * NEBULA_SIZE) + x) * 4
        image.data[offset] = 255
        image.data[offset + 1] = 255
        image.data[offset + 2] = 255
        image.data[offset + 3] = Math.round(fade * 255)
      }
    }
    context.putImageData(image, 0, 0)
  }
  return new CanvasTexture(canvas)
}
