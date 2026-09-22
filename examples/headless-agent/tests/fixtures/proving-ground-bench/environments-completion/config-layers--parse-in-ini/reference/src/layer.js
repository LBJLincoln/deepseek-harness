/** Stacking layers: the last layer that sets a key wins, and the winner remembers which layer it was. */

/**
 * Merge named layers, later over earlier.
 * @param {readonly {name: string, values: Map<string, {text: string, line: number, column: number}>}[]} layers - the layers, weakest first.
 * @returns {Map<string, {name: string, text: string, line: number, column: number}>} each key's winning value, with the layer that set it.
 */
export function merge(layers) {
  const merged = new Map()
  for (const layer of layers) {
    for (const [key, value] of layer.values) merged.set(key, { name: layer.name, ...value })
  }
  return merged
}
