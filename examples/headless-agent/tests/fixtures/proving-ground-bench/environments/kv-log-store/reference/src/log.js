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

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/** Header size in bytes: a big-endian length followed by a big-endian CRC. */
export const HEADER_BYTES = 8;

/**
 * Standard CRC-32 (reflected, polynomial 0xEDB88320).
 *
 * @param {Uint8Array} bytes Payload to checksum.
 * @returns {number} Unsigned 32-bit checksum.
 */
export function crc32(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new StoreError('BAD_INPUT', 'bytes must be a Uint8Array');
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Report whether a decoded payload is a well-formed record.
 *
 * @param {unknown} record Candidate record.
 * @returns {boolean} True when the record can be applied.
 */
export function isRecord(record) {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return false;
  if (typeof record.k !== 'string' || record.k === '') return false;
  if (record.t === 'put') return 'v' in record;
  return record.t === 'del';
}

/**
 * Frame one record.
 *
 * @param {{t: string, k: string, v?: unknown}} record Record to encode.
 * @returns {Uint8Array} Framed bytes.
 */
export function encodeRecord(record) {
  if (!isRecord(record)) throw new StoreError('BAD_RECORD', 'record must be a put or del entry');
  const payload = new TextEncoder().encode(JSON.stringify(record));
  const frame = new Uint8Array(HEADER_BYTES + payload.length);
  const view = new DataView(frame.buffer);
  view.setUint32(0, payload.length, false);
  view.setUint32(4, crc32(payload), false);
  frame.set(payload, HEADER_BYTES);
  return frame;
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
  if (!(bytes instanceof Uint8Array)) throw new StoreError('BAD_INPUT', 'bytes must be a Uint8Array');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const records = [];
  let offset = 0;
  let truncated = false;
  while (offset < bytes.length) {
    if (bytes.length - offset < HEADER_BYTES) {
      truncated = true;
      break;
    }
    const length = view.getUint32(offset, false);
    if (bytes.length - offset - HEADER_BYTES < length) {
      truncated = true;
      break;
    }
    const payload = bytes.subarray(offset + HEADER_BYTES, offset + HEADER_BYTES + length);
    if (crc32(payload) !== view.getUint32(offset + 4, false)) {
      truncated = true;
      break;
    }
    let record;
    try {
      record = JSON.parse(decoder.decode(payload));
    } catch {
      // A frame whose payload is not JSON is indistinguishable from a torn tail.
      truncated = true;
      break;
    }
    if (!isRecord(record)) {
      truncated = true;
      break;
    }
    records.push(record);
    offset += HEADER_BYTES + length;
  }
  return { records, bytesUsed: offset, truncated };
}
