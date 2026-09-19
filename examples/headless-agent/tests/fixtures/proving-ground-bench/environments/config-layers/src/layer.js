/** Stacking layers: the last layer that sets a key wins. */

/**
 * Merge named layers, later over earlier.
 * @param {readonly {name: string, values: Map<string, string>}[]} layers - the layers, weakest first.
 * @returns {Map<string, string>} each key's winning raw text.
 */
export function merge(layers) {
  const merged = new Map()
  for (const layer of layers) {
    for (const [key, text] of layer.values) merged.set(key, text)
  }
  return merged
}
