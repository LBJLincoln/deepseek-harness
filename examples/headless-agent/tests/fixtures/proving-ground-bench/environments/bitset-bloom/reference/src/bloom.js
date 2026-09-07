import { BitSet, byteLength } from './bitset.js';

/**
 * Bloom filter over strings, using double hashing.
 *
 * Two 32-bit FNV-1a hashes are derived from the value and the seed; probe `i`
 * lands on `(h1 + i * h2) mod bits`, computed unsigned so a probe is always a
 * valid bit index. A filter answers `has` with no false negatives; a `true`
 * answer may be a false positive.
 */

/** File signature written at the start of a serialized filter: "BLM1". */
const MAGIC = [0x42, 0x4c, 0x4d, 0x31];
/** Bytes of header before the bit payload. */
const HEADER_BYTES = 17;
/** FNV-1a 32-bit offset basis. */
const FNV_OFFSET = 0x811c9dc5;
/** FNV-1a 32-bit prime. */
const FNV_PRIME = 0x01000193;
/** Constant mixed into the seed for the second hash. */
const SECOND_SEED = 0x9e3779b9;

/**
 * FNV-1a over the UTF-16 code units of a string.
 * @param {string} value Value to hash.
 * @param {number} seed Starting seed.
 * @returns {number} Unsigned 32-bit hash.
 */
function fnv1a(value, seed) {
  let hash = (FNV_OFFSET ^ seed) >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash ^ value.charCodeAt(index)) >>> 0;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/** Bloom filter with a fixed bit count and probe count. */
export class BloomFilter {
  #bits;
  #hashes;
  #seed;
  #set;
  #count = 0;

  /**
   * @param {object} options Filter options.
   * @param {number} options.bits Bit count; a positive safe integer.
   * @param {number} options.hashes Probes per value; a positive safe integer.
   * @param {number} [options.seed] Hash seed; an unsigned 32-bit integer, zero by default.
   */
  constructor(options) {
    if (typeof options !== 'object' || options === null) throw new TypeError('options must be an object');
    const { bits, hashes, seed = 0 } = options;
    if (!Number.isSafeInteger(bits) || bits <= 0) throw new TypeError('bits must be a positive integer');
    if (!Number.isSafeInteger(hashes) || hashes <= 0) throw new TypeError('hashes must be a positive integer');
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new TypeError('seed must be a 32-bit unsigned integer');
    }
    this.#bits = bits;
    this.#hashes = hashes;
    this.#seed = seed;
    this.#set = new BitSet(bits);
  }

  /** @returns {number} Bit count. */
  get bits() {
    return this.#bits;
  }

  /** @returns {number} Probes per value. */
  get hashes() {
    return this.#hashes;
  }

  /** @returns {number} Hash seed. */
  get seed() {
    return this.#seed;
  }

  /** @returns {number} How many values have been added. */
  get count() {
    return this.#count;
  }

  /**
   * Bit indices a value touches.
   * @param {string} value Value to probe.
   * @returns {number[]} One index per hash.
   * @throws {TypeError} When the value is not a string.
   */
  #probes(value) {
    if (typeof value !== 'string') throw new TypeError('value must be a string');
    const first = fnv1a(value, this.#seed);
    const second = (fnv1a(value, (this.#seed ^ SECOND_SEED) >>> 0) | 1) >>> 0;
    const out = [];
    for (let index = 0; index < this.#hashes; index += 1) {
      out.push(((first + Math.imul(index, second)) >>> 0) % this.#bits);
    }
    return out;
  }

  /**
   * Records a value.
   * @param {string} value Value to add.
   * @returns {BloomFilter} This filter.
   */
  add(value) {
    for (const index of this.#probes(value)) this.#set.set(index);
    this.#count += 1;
    return this;
  }

  /**
   * Reports whether a value may have been added.
   * @param {string} value Value to look up.
   * @returns {boolean} False when the value is certainly absent.
   */
  has(value) {
    for (const index of this.#probes(value)) {
      if (!this.#set.get(index)) return false;
    }
    return true;
  }

  /**
   * Fraction of bits currently set.
   * @returns {number} Value between zero and one.
   */
  fillRatio() {
    return this.#set.count() / this.#bits;
  }

  /**
   * Exposes the backing bit set so filters can be combined and written out.
   * @returns {BitSet} The backing bit set.
   */
  bitSet() {
    return this.#set;
  }

  /**
   * Merges another filter built with the same parameters.
   * @param {BloomFilter} other Filter to merge.
   * @returns {BloomFilter} New filter holding every bit of both.
   * @throws {TypeError} When the argument is not a filter.
   * @throws {RangeError} When the parameters differ.
   */
  union(other) {
    if (!(other instanceof BloomFilter)) throw new TypeError('argument must be a BloomFilter');
    if (other.bits !== this.#bits || other.hashes !== this.#hashes || other.seed !== this.#seed) {
      throw new RangeError('bloom filters must share their parameters');
    }
    const merged = new BloomFilter({ bits: this.#bits, hashes: this.#hashes, seed: this.#seed });
    const words = merged.bitSet().words();
    const mine = this.#set.words();
    const theirs = other.bitSet().words();
    for (let index = 0; index < words.length; index += 1) words[index] = mine[index] | theirs[index];
    merged.setCount(this.#count + other.count);
    return merged;
  }

  /**
   * Overrides the recorded number of added values.
   * @param {number} count New count; a non-negative safe integer.
   * @returns {void}
   * @throws {TypeError} When the count is not a non-negative safe integer.
   */
  setCount(count) {
    if (!Number.isSafeInteger(count) || count < 0) throw new TypeError('count must be a non-negative integer');
    this.#count = count;
  }

  /**
   * Writes the filter as bytes: a four-byte signature, the bit count, the
   * seed, the probe count, the number of added values, and then the bits.
   * @returns {Uint8Array} Serialized filter.
   */
  serialize() {
    const payload = this.#set.toBytes();
    const bytes = new Uint8Array(HEADER_BYTES + payload.length);
    bytes.set(MAGIC, 0);
    const view = new DataView(bytes.buffer);
    view.setUint32(4, this.#bits, true);
    view.setUint32(8, this.#seed, true);
    bytes[12] = this.#hashes;
    view.setUint32(13, this.#count, true);
    bytes.set(payload, HEADER_BYTES);
    return bytes;
  }

  /**
   * Rebuilds a filter written by `serialize`.
   * @param {Uint8Array} bytes Serialized filter.
   * @returns {BloomFilter} Restored filter.
   * @throws {TypeError} When the argument is not a Uint8Array.
   * @throws {Error} When the signature is missing.
   * @throws {RangeError} When the payload length disagrees with the header.
   */
  static deserialize(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('bytes must be a Uint8Array');
    if (bytes.length < HEADER_BYTES || MAGIC.some((byte, index) => bytes[index] !== byte)) {
      throw new Error('unrecognised bloom filter header');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const bits = view.getUint32(4, true);
    const seed = view.getUint32(8, true);
    const hashes = bytes[12];
    const count = view.getUint32(13, true);
    if (bytes.length !== HEADER_BYTES + byteLength(bits)) {
      throw new RangeError('serialized length does not match the header');
    }
    const filter = new BloomFilter({ bits, hashes, seed });
    const restored = BitSet.fromBytes(bytes.slice(HEADER_BYTES), bits);
    filter.bitSet().words().set(restored.words());
    filter.setCount(count);
    return filter;
  }
}
