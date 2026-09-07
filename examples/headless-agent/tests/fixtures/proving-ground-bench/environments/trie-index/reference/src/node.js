/**
 * One node of the trie.
 *
 * `children` is keyed by a single Unicode code point, so a character outside
 * the basic plane is one step rather than two. `words` counts the stored words
 * in this node's subtree, which is what makes a prefix count a walk of the
 * prefix rather than a walk of the subtree.
 */
export class TrieNode {
  constructor() {
    /** @type {Map<string, TrieNode>} */
    this.children = new Map();
    this.words = 0;
    this.hasValue = false;
    /** @type {unknown} */
    this.value = undefined;
  }
}

/**
 * Lists a node's child code points in ascending code point order.
 * @param {TrieNode} node Node whose children to list.
 * @returns {string[]} Sorted child keys.
 */
export function sortedChildren(node) {
  return [...node.children.keys()].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
}
