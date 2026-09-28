/**
 * A strongly-typed version of `String.prototype.replace`.
 * @param sentence the sentence to replace.
 * @param lookup the lookup string to be replaced.
 * @param replacement the replacement string.
 * @returns the replaced string in both type level and runtime.
 * @example replace('hello world', 'l', '1') // 'he1lo world'
 */
export function replace(sentence, lookup, replacement = '') {
    return sentence.replace(lookup, replacement);
}
