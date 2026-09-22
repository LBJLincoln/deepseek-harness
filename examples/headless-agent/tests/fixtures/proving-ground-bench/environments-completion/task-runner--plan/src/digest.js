/** FNV-1a over raw bytes, the digest the snapshot format records. */

const OFFSET = 0x811c9dc5
const PRIME = 16777619

/**
 * The 32-bit FNV-1a digest of a byte buffer as eight lowercase hex digits.
 * @param {Buffer} bytes - the bytes to digest.
 * @returns {string} the digest.
 */
export function digestBytes(bytes) {
  let hash = OFFSET >>> 0
  for (const byte of bytes) {
    hash = (hash ^ byte) >>> 0
    hash = Math.imul(hash, PRIME) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
