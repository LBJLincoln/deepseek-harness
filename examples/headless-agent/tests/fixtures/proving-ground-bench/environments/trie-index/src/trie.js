/**
 * Prefix index over Unicode strings.
 *
 * This starting point keeps the words in a plain map, so exact lookups work
 * but nothing prefix-shaped does and no node bookkeeping exists.
 */
export class Trie {
  /** @type {Map<string, unknown>} */
  #words = new Map();

  /** @returns {number} Number of stored words. */
  get size() {
    return this.#words.size;
  }

  /** @returns {number} Number of nodes, the root included. */
  get nodeCount() {
    return 1;
  }

  /**
   * Stores a value under a word, replacing any value already there.
   * @param {string} word Word to store.
   * @param {unknown} value Value to associate.
   * @returns {unknown} Previously stored value, or undefined when the word is new.
   */
  insert(word, value) {
    const previous = this.#words.get(word);
    this.#words.set(word, value);
    return previous;
  }

  /**
   * Reads the value stored under a word.
   * @param {string} word Word to look up.
   * @returns {unknown} Stored value, or undefined when the word is absent.
   */
  get(word) {
    return this.#words.get(word);
  }

  /**
   * Reports whether a word is stored.
   * @param {string} word Word to look up.
   * @returns {boolean} True when the word is stored.
   */
  has(word) {
    return this.#words.has(word);
  }

  /**
   * Removes a word and any nodes it alone kept alive.
   * @param {string} word Word to remove.
   * @returns {boolean} True when a word was removed.
   */
  delete(word) {
    return this.#words.delete(word);
  }

  /**
   * Counts the stored words that start with a prefix.
   * @param {string} prefix Prefix to count under.
   * @returns {number} Number of words with that prefix.
   */
  countPrefix(prefix) {
    throw new Error('not implemented');
  }

  /**
   * Lists the stored words that start with a prefix, in code point order.
   * @param {string} prefix Prefix to search under.
   * @param {number} [limit] Maximum number of words to return.
   * @returns {string[]} Matching words.
   */
  search(prefix, limit = Number.POSITIVE_INFINITY) {
    throw new Error('not implemented');
  }

  /**
   * Lists every stored word with its value, in code point order.
   * @returns {Array<[string, unknown]>} Word and value pairs.
   */
  entries() {
    throw new Error('not implemented');
  }

  /**
   * Finds the longest stored word that is a prefix of the text.
   * @param {string} text Text to match against.
   * @returns {{word: string, value: unknown} | null} Longest match, or null.
   */
  longestPrefixMatch(text) {
    throw new Error('not implemented');
  }
}
