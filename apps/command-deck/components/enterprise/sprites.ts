/**
 * The soft shapes the enterprise scene draws its light with.
 *
 * Both are built once in the browser rather than loaded: a texture file for a
 * radial gradient would be a network round trip for something four lines of
 * canvas describe exactly, and the beam's falloff is carried by vertex colours
 * so one instanced draw call covers every burst on screen.
 */

import { BufferAttribute, CanvasTexture, PlaneGeometry, type Texture } from 'three'

/** Edge length of the generated nebula texture, in pixels. */
const NEBULA_SIZE = 128

/** Columns and rows of the beam plane; the falloff is carried by their vertex colours. */
const BEAM_COLUMNS = 2
const BEAM_ROWS = 4

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

/**
 * The plane one certificate beam stands on: one unit wide, one unit tall, its
 * base at the origin.
 *
 * Vertex colours carry the whole falloff — black at the top and at both sides,
 * white along the base's centre line — so an additive draw fades the shaft out
 * without a texture and without a per-beam material.
 * @returns A geometry owned by the caller, which disposes it.
 */
export function createBeamGeometry(): PlaneGeometry {
  const geometry = new PlaneGeometry(1, 1, BEAM_COLUMNS, BEAM_ROWS)
  geometry.translate(0, 0.5, 0)
  const position = geometry.getAttribute('position')
  const colors = new Float32Array(position.count * 3)
  for (let vertex = 0; vertex < position.count; vertex++) {
    const across = Math.abs(position.getX(vertex)) * 2
    const up = position.getY(vertex)
    const fade = (1 - (across ** 2)) * ((1 - up) ** 1.6)
    colors[vertex * 3] = fade
    colors[(vertex * 3) + 1] = fade
    colors[(vertex * 3) + 2] = fade
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return geometry
}
