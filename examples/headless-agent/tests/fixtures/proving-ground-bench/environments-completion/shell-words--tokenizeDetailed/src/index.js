/**
 * A shell-like word splitter: quoting, backslash escapes, comments and
 * `$VAR` expansion from a caller-supplied environment, plus the inverse
 * quoting used to rebuild a command line.
 */

/** Error raised for input the tokenizer cannot finish reading. */
export class ShellWordsError extends Error {
  /**
   * @param {string} code Stable machine-readable reason.
   * @param {string} message Human-readable detail.
   * @param {number} index Zero-based offset of the offending character.
   */
  constructor(code, message, index) {
    super(message);
    this.name = 'ShellWordsError';
    this.code = code;
    this.index = index;
  }
}

const SEPARATORS = new Set([' ', '\t', '\n']);
const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[A-Za-z0-9_]/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ESCAPABLE_IN_QUOTES = new Set(['$', '"', '\\', '`']);
const SAFE_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/;

/**
 * Split a command line into words, reporting where each one came from.
 *
 * @param {string} input Command line to split.
 * @param {{env?: Record<string, string>, strict?: boolean}} [options] Expansion environment and unset-variable policy.
 * @returns {Array<{value: string, start: number, end: number, quoted: boolean}>} Words in order.
 */
export function tokenizeDetailed(input, options = {}) {
  throw new Error('not implemented')
}

/**
 * Split a command line into words.
 *
 * @param {string} input Command line to split.
 * @param {{env?: Record<string, string>, strict?: boolean}} [options] Expansion environment and unset-variable policy.
 * @returns {string[]} Words in order.
 */
export function tokenize(input, options = {}) {
  return tokenizeDetailed(input, options).map((token) => token.value);
}

/**
 * Quote one word so a tokenizer reads it back unchanged.
 *
 * @param {string} word Word to quote.
 * @returns {string} Quoted word.
 */
export function quote(word) {
  if (typeof word !== 'string') throw new ShellWordsError('BAD_INPUT', 'word must be a string', 0);
  if (word === '') return "''";
  if (SAFE_WORD.test(word)) return word;
  return `'${word.split("'").join("'\\''")}'`;
}

/**
 * Quote and join words into a command line.
 *
 * @param {string[]} words Words to join.
 * @returns {string} Command line.
 */
export function join(words) {
  if (!Array.isArray(words)) throw new ShellWordsError('BAD_INPUT', 'words must be an array', 0);
  return words.map((word) => quote(word)).join(' ');
}

/**
 * Split leading `NAME=value` words from the command they precede.
 *
 * @param {string[]} tokens Words produced by the tokenizer.
 * @returns {{assignments: Record<string, string>, argv: string[]}} Prefix assignments and the remaining words.
 */
export function parseAssignments(tokens) {
  if (!Array.isArray(tokens)) throw new ShellWordsError('BAD_INPUT', 'tokens must be an array', 0);
  const assignments = {};
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (typeof token !== 'string') throw new ShellWordsError('BAD_INPUT', 'tokens must be strings', index);
    const match = ASSIGNMENT.exec(token);
    if (match === null) break;
    assignments[match[1]] = match[2];
    index += 1;
  }
  return { assignments, argv: tokens.slice(index) };
}

/**
 * Split a command line into commands separated by bare semicolons.
 *
 * A semicolon only separates when the whole word was written as a bare `;`, so
 * a quoted or escaped semicolon stays part of its command.
 *
 * @param {string} input Command line to split.
 * @param {{env?: Record<string, string>, strict?: boolean}} [options] Expansion environment and unset-variable policy.
 * @returns {string[][]} One word list per command, with empty commands dropped.
 */
export function splitCommands(input, options = {}) {
  const commands = [];
  let current = [];
  for (const token of tokenizeDetailed(input, options)) {
    if (input.slice(token.start, token.end) === ';') {
      if (current.length > 0) commands.push(current);
      current = [];
      continue;
    }
    current.push(token.value);
  }
  if (current.length > 0) commands.push(current);
  return commands;
}
