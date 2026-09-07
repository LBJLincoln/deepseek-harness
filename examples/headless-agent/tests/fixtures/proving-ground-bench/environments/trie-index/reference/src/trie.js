import { sortedChildren, TrieNode } from './node.js';

/**
 * Prefix index over Unicode strings.
 *
 * Words are walked by code point. Every node carries the number of words in
 * its subtree, so `countPrefix` costs the length of the prefix; `delete`
 * removes the nodes it empties, so `nodeCount` always equals the number of
 * distinct prefixes of the stored words, the empty prefix included.
 */
export class Trie {
  #root = new TrieNode();
  #size = 0;
  #nodes = 1;

  /** @returns {number} Number of stored words. */
  get size() {
    return this.#size;
  }

  /** @returns {number} Number of nodes, the root included. */
  get nodeCount() {
    return this.#nodes;
  }

  /**
   * Walks to the node for a string without creating anything.
   * @param {string[]} chars Code points to follow.
   * @returns {TrieNode | undefined} Node reached, or undefined.
   */
  #walk(chars) {
    let node = this.#root;
    for (const char of chars) {
      node = node.children.get(char);
      if (node === undefined) return undefined;
    }
    return node;
  }

  /**
   * Stores a value under a word, replacing any value already there.
   * @param {string} word Word to store.
   * @param {unknown} value Value to associate.
   * @returns {unknown} Previously stored value, or undefined when the word is new.
   * @throws {TypeError} When the word is not a string.
   */
  insert(word, value) {
    checkString(word, 'word');
    const chars = [...word];
    let node = this.#root;
    const path = [node];
    for (const char of chars) {
      let next = node.children.get(char);
      if (next === undefined) {
        next = new TrieNode();
        node.children.set(char, next);
        this.#nodes += 1;
      }
      node = next;
      path.push(node);
    }
    if (node.hasValue) {
      const previous = node.value;
      node.value = value;
      return previous;
    }
    node.hasValue = true;
    node.value = value;
    this.#size += 1;
    for (const visited of path) visited.words += 1;
    return undefined;
  }

  /**
   * Reads the value stored under a word.
   * @param {string} word Word to look up.
   * @returns {unknown} Stored value, or undefined when the word is absent.
   * @throws {TypeError} When the word is not a string.
   */
  get(word) {
    checkString(word, 'word');
    const node = this.#walk([...word]);
    return node !== undefined && node.hasValue ? node.value : undefined;
  }

  /**
   * Reports whether a word is stored.
   * @param {string} word Word to look up.
   * @returns {boolean} True when the word is stored.
   * @throws {TypeError} When the word is not a string.
   */
  has(word) {
    checkString(word, 'word');
    const node = this.#walk([...word]);
    return node !== undefined && node.hasValue;
  }

  /**
   * Removes a word and any nodes it alone kept alive.
   * @param {string} word Word to remove.
   * @returns {boolean} True when a word was removed.
   * @throws {TypeError} When the word is not a string.
   */
  delete(word) {
    checkString(word, 'word');
    const chars = [...word];
    const path = [this.#root];
    let node = this.#root;
    for (const char of chars) {
      node = node.children.get(char);
      if (node === undefined) return false;
      path.push(node);
    }
    if (!node.hasValue) return false;
    node.hasValue = false;
    node.value = undefined;
    this.#size -= 1;
    for (const visited of path) visited.words -= 1;
    for (let depth = path.length - 1; depth > 0; depth -= 1) {
      const child = path[depth];
      if (child.hasValue || child.children.size > 0) break;
      path[depth - 1].children.delete(chars[depth - 1]);
      this.#nodes -= 1;
    }
    return true;
  }

  /**
   * Counts the stored words that start with a prefix.
   * @param {string} prefix Prefix to count under.
   * @returns {number} Number of words with that prefix.
   * @throws {TypeError} When the prefix is not a string.
   */
  countPrefix(prefix) {
    checkString(prefix, 'prefix');
    const node = this.#walk([...prefix]);
    return node === undefined ? 0 : node.words;
  }

  /**
   * Collects words under a node in code point order.
   * @param {TrieNode} node Subtree root.
   * @param {string} prefix Word built so far.
   * @param {number} limit Maximum number of entries to collect.
   * @param {Array<[string, unknown]>} out Collected entries.
   * @returns {void}
   */
  #collect(node, prefix, limit, out) {
    if (out.length >= limit) return;
    if (node.hasValue) out.push([prefix, node.value]);
    for (const char of sortedChildren(node)) {
      if (out.length >= limit) return;
      this.#collect(node.children.get(char), prefix + char, limit, out);
    }
  }

  /**
   * Lists the stored words that start with a prefix, in code point order.
   * @param {string} prefix Prefix to search under.
   * @param {number} [limit] Maximum number of words to return.
   * @returns {string[]} Matching words.
   * @throws {TypeError} When the prefix or limit is malformed.
   */
  search(prefix, limit = Number.POSITIVE_INFINITY) {
    checkString(prefix, 'prefix');
    if (limit !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(limit) || limit < 0)) {
      throw new TypeError('limit must be a non-negative integer');
    }
    const node = this.#walk([...prefix]);
    if (node === undefined) return [];
    /** @type {Array<[string, unknown]>} */
    const out = [];
    this.#collect(node, prefix, limit, out);
    return out.map(([word]) => word);
  }

  /**
   * Lists every stored word with its value, in code point order.
   * @returns {Array<[string, unknown]>} Word and value pairs.
   */
  entries() {
    /** @type {Array<[string, unknown]>} */
    const out = [];
    this.#collect(this.#root, '', Number.POSITIVE_INFINITY, out);
    return out;
  }

  /**
   * Finds the longest stored word that is a prefix of the text.
   * @param {string} text Text to match against.
   * @returns {{word: string, value: unknown} | null} Longest match, or null.
   * @throws {TypeError} When the text is not a string.
   */
  longestPrefixMatch(text) {
    checkString(text, 'text');
    let node = this.#root;
    let best = node.hasValue ? { word: '', value: node.value } : null;
    let seen = '';
    for (const char of text) {
      node = node.children.get(char);
      if (node === undefined) break;
      seen += char;
      if (node.hasValue) best = { word: seen, value: node.value };
    }
    return best;
  }
}

/**
 * Validates a string argument.
 * @param {unknown} value Candidate value.
 * @param {string} label Argument name used in the message.
 * @returns {void}
 * @throws {TypeError} When the value is not a string.
 */
function checkString(value, label) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
}
