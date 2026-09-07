/**
 * Fixed-size bit set backed by 32-bit words.
 *
 * Bits are numbered from zero. The byte form is portable: byte `b` carries
 * bits `8b` to `8b + 7`, with bit `8b + k` at value `1 << k`, and any bits
 * past the declared size are zero.
 */
export class BitSet {
  #nbits;
  #words;

  /**
   * @param {number} nbits How many bits the set holds; a positive safe integer.
   * @throws {TypeError} When the size is not a positive safe integer.
   */
  constructor(nbits) {
    if (!Number.isSafeInteger(nbits) || nbits <= 0) throw new TypeError('size must be a positive integer');
    this.#nbits = nbits;
    this.#words = new Uint32Array(Math.ceil(nbits / 32));
  }

  /** @returns {number} How many bits the set holds. */
  get size() {
    return this.#nbits;
  }

  /**
   * Validates a bit index.
   * @param {unknown} index Candidate index.
   * @returns {number} The index itself.
   * @throws {RangeError} When the index is outside `0 .. size - 1`.
   */
  #check(index) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.#nbits) {
      throw new RangeError(`bit index out of range: ${String(index)}`);
    }
    return index;
  }

  /**
   * Turns a bit on.
   * @param {number} index Bit to set.
   * @returns {BitSet} This set.
   */
  set(index) {
    this.#check(index);
    this.#words[index >>> 5] |= 1 << (index & 31);
    return this;
  }

  /**
   * Turns a bit off.
   * @param {number} index Bit to clear.
   * @returns {BitSet} This set.
   */
  clear(index) {
    this.#check(index);
    this.#words[index >>> 5] &= ~(1 << (index & 31));
    return this;
  }

  /**
   * Flips a bit.
   * @param {number} index Bit to flip.
   * @returns {BitSet} This set.
   */
  toggle(index) {
    this.#check(index);
    this.#words[index >>> 5] ^= 1 << (index & 31);
    return this;
  }

  /**
   * Reads a bit.
   * @param {number} index Bit to read.
   * @returns {boolean} True when the bit is on.
   */
  get(index) {
    this.#check(index);
    return (this.#words[index >>> 5] & (1 << (index & 31))) !== 0;
  }

  /**
   * Counts the bits that are on.
   * @returns {number} Population count.
   */
  count() {
    let total = 0;
    for (const word of this.#words) total += popcount(word);
    return total;
  }

  /**
   * Reports whether another set holds the same size and bits.
   * @param {BitSet} other Set to compare with.
   * @returns {boolean} True when both are equal.
   */
  equals(other) {
    checkSet(other);
    if (other.size !== this.#nbits) return false;
    const words = other.words();
    for (let index = 0; index < this.#words.length; index += 1) {
      if (this.#words[index] !== words[index]) return false;
    }
    return true;
  }

  /**
   * Exposes the backing words so sets can combine without copying bit by bit.
   * @returns {Uint32Array} The backing words.
   */
  words() {
    return this.#words;
  }

  /**
   * Builds the union of two sets of the same size.
   * @param {BitSet} other Set to combine with.
   * @returns {BitSet} New set holding every bit of either input.
   * @throws {RangeError} When the sizes differ.
   */
  or(other) {
    const result = this.#combined(other);
    const words = other.words();
    for (let index = 0; index < this.#words.length; index += 1) {
      result.words()[index] = this.#words[index] | words[index];
    }
    return result;
  }

  /**
   * Builds the intersection of two sets of the same size.
   * @param {BitSet} other Set to combine with.
   * @returns {BitSet} New set holding the bits present in both inputs.
   * @throws {RangeError} When the sizes differ.
   */
  and(other) {
    const result = this.#combined(other);
    const words = other.words();
    for (let index = 0; index < this.#words.length; index += 1) {
      result.words()[index] = this.#words[index] & words[index];
    }
    return result;
  }

  /**
   * Checks that two sets can be combined and allocates the result.
   * @param {BitSet} other Set to combine with.
   * @returns {BitSet} Empty set of the shared size.
   * @throws {RangeError} When the sizes differ.
   */
  #combined(other) {
    checkSet(other);
    if (other.size !== this.#nbits) throw new RangeError('bit sets must have the same size');
    return new BitSet(this.#nbits);
  }

  /**
   * Copies the bits into bytes.
   * @returns {Uint8Array} `ceil(size / 8)` bytes, least significant bit first.
   */
  toBytes() {
    const bytes = new Uint8Array(byteLength(this.#nbits));
    for (let index = 0; index < this.#nbits; index += 1) {
      if (this.get(index)) bytes[index >>> 3] |= 1 << (index & 7);
    }
    return bytes;
  }

  /**
   * Rebuilds a set from bytes.
   * @param {Uint8Array} bytes Bytes from `toBytes`.
   * @param {number} nbits Size the bytes describe.
   * @returns {BitSet} Restored set.
   * @throws {TypeError} When the bytes are not a Uint8Array.
   * @throws {RangeError} When the byte count or the padding bits are wrong.
   */
  static fromBytes(bytes, nbits) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('bytes must be a Uint8Array');
    const set = new BitSet(nbits);
    if (bytes.length !== byteLength(nbits)) throw new RangeError('byte length does not match bit size');
    for (let index = 0; index < nbits; index += 1) {
      if ((bytes[index >>> 3] & (1 << (index & 7))) !== 0) set.set(index);
    }
    const spare = byteLength(nbits) * 8 - nbits;
    if (spare > 0 && (bytes[bytes.length - 1] >>> (8 - spare)) !== 0) {
      throw new RangeError('bytes hold bits beyond the set size');
    }
    return set;
  }
}

/**
 * Bytes needed to carry a number of bits.
 * @param {number} nbits Bit count.
 * @returns {number} Byte count.
 */
export function byteLength(nbits) {
  return Math.ceil(nbits / 8);
}

/**
 * Counts the bits set in one 32-bit word.
 * @param {number} word Word to count.
 * @returns {number} Population count, including bit 31.
 */
function popcount(word) {
  let value = word - ((word >>> 1) & 0x55555555);
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  value = (value + (value >>> 4)) & 0x0f0f0f0f;
  return Math.imul(value, 0x01010101) >>> 24;
}

/**
 * Validates that a value is a bit set.
 * @param {unknown} value Candidate set.
 * @returns {void}
 * @throws {TypeError} When the value is not a BitSet.
 */
function checkSet(value) {
  if (!(value instanceof BitSet)) throw new TypeError('argument must be a BitSet');
}
