// This is the most efficient way to check an arbitrary string if it is a simple
// non-negative integer. We use character ranges instead of the `\d` character
// class to avoid matching non-ascii digits (e.g. Arabic-Indic digits), while
// maintaining that the regular expression supports unicode.
const NON_NEGATIVE_INTEGER_RE = /^(?:0|[1-9][0-9]*)$/u;
/**
 * A utility to allow JSONPath-like strings to be used in other utilities which
 * take an array of path segments as input (e.g. `prop`, `setPath`, etc...).
 * The main purpose of this utility is to act as a bridge between the runtime
 * implementation that converts the path to an array, and the type-system that
 * parses the path string **type** into an array **type**. This type allows us
 * to return fine-grained types and to enforce correctness at the type-level.
 *
 * We **discourage** using this utility for new code. This utility is for legacy
 * code that already contains path strings (which are accepted by Lodash). We
 * strongly recommend using *path arrays* instead as they provide better
 * developer experience via significantly faster type-checking, fine-grained
 * error messages, and automatic typeahead suggestions for each segment of the
 * path.
 *
 * *There are a bunch of limitations to this utility derived from the
 * limitations of the type itself, these are usually edge-cases around deeply
 * nested paths, escaping, whitespaces, and empty segments. This is true even
 * in cases where the runtime implementation can better handle them, this is
 * intentional. See the tests for this utility for more details and the
 * expected outputs*.
 *
 * @param stringPath - A string path.
 * @signature
 *   stringToPath(stringPath)
 * @example
 *   stringToPath('a.b[0].c') // => ['a', 'b', 0, 'c']
 * @dataFirst
 * @category Utility
 */
export function stringToPath(stringPath) {
    throw new Error('not implemented');
}
