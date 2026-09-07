/**
 * Append-only log framing: CRC-checked, length-prefixed records that survive
 * being cut off at an arbitrary byte.
 */

/** Error raised for invalid store or log input. */
export class StoreError extends Error {
  /**
   * @param {string} code Stable machine-readable reason.
   * @param {string} message Human-readable detail.
   */
  constructor(code, message) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}

/** Header size in bytes: a big-endian length followed by a big-endian CRC. */
export const HEADER_BYTES = 8;

/**
 * Standard CRC-32 (reflected, polynomial 0xEDB88320).
 *
 * @param {Uint8Array} bytes Payload to checksum.
 * @returns {number} Unsigned 32-bit checksum.
 */
export function crc32(bytes) {
  throw new Error('not implemented');
}

/**
 * Report whether a decoded payload is a well-formed record.
 *
 * @param {unknown} record Candidate record.
 * @returns {boolean} True when the record can be applied.
 */
export function isRecord(record) {
  throw new Error('not implemented');
}

/**
 * Frame one record.
 *
 * @param {{t: string, k: string, v?: unknown}} record Record to encode.
 * @returns {Uint8Array} Framed bytes.
 */
export function encodeRecord(record) {
  throw new Error('not implemented');
}

/**
 * Decode every intact record at the front of a log.
 *
 * Never throws for well-typed input: a torn or corrupted frame simply ends the scan.
 *
 * @param {Uint8Array} bytes Log bytes, possibly truncated mid-frame.
 * @returns {{records: object[], bytesUsed: number, truncated: boolean}} Decoded prefix.
 */
export function decodeLog(bytes) {
  throw new Error('not implemented');
}
