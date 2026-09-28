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
    const result = [];
    // There are four possible ways to define a path segment::
    // - `propName`: is used to parse dot-notation paths, e.g. 'foo.bar.baz', we
    // allow multiple sequential dots because our type allows them, but they are
    // semantically meaningless. Note that this would also allow strings starting
    // with a dot, e.g. `.foo`, this is fine because the dot itself is just used
    // as a separator and is ignored in the final path.
    // - `quoted`, `doubleQuoted`: used within square bracket notation to prevent
    // any recursive parsing of their contents. As for the type itself, we only
    // allow quote symbols to appear immediately after the opening square bracket
    // and immediately before the closing square bracket, this allows us to handle
    // more gracefully cases where a quote symbol might appear within the quoted
    // part.
    // - `unquoted`: If the contents of the square brackets are not quoted they
    // will match this group (this is why the order is important here!). Contents
    // of this group get parsed *recursively*.
    //
    // NOTE: We limit all repeats to 4096 characters to avoid a possible attack
    // vector when the input to this function is controlled by the user. This is
    // due to a DoS timing attack because regex backtracking is non-linear.
    // @see: https://codeql.github.com/codeql-query-help/javascript/js-polynomial-redos/
    const pathSegmentRe = /\.{0,4096}(?<propName>[^.[\]]+)|\['(?<quoted>.{0,4096}?)'\]|\["(?<doubleQuoted>.{0,4096}?)"\]|\[(?<unquoted>.{0,4096}?)\]/uy;
    let match;
    while ((match = pathSegmentRe.exec(stringPath)) !== null) {
        const { propName, quoted, doubleQuoted, unquoted } = match.groups;
        if (unquoted !== undefined) {
            result.push(...stringToPath(unquoted));
            continue;
        }
        result.push(propName === undefined
            ? (quoted ?? doubleQuoted)
            : // The only way to differentiate between array indices and properties
                // is to check if the property is a non-negative integer. In those
                // cases we perform the conversion (unlike Lodash).
                NON_NEGATIVE_INTEGER_RE.test(propName)
                    ? Number(propName)
                    : propName);
    }
    // @ts-expect-error [ts2322] -- It's impossible for TypeScript to infer that our algorithm actually computes StringToPath.
    return result;
}
