/**
 * A strongly-typed version of `String.prototype.replaceAll`.
 * @param sentence the sentence to replace.
 * @param lookup the lookup string to be replaced.
 * @param replacement the replacement string.
 * @returns the replaced string in both type level and runtime.
 * @example replaceAll('hello world', 'l', '1') // 'he11o wor1d'
 */
export function replaceAll(sentence, lookup, replacement = '') {
    // Only supported in ES2021+
    if (typeof sentence.replaceAll === 'function') {
        return sentence.replaceAll(lookup, replacement);
    }
    const regex = new RegExp(lookup, 'g');
    return sentence.replace(regex, replacement);
}
