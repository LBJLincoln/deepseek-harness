/**
 * A strongly-typed version of `String.prototype.split`.
 * @param str the string to split.
 * @param delimiter the delimiter.
 * @returns the splitted string in both type level and runtime.
 * @example split('hello world', ' ') // ['hello', 'world']
 */
export function split(str, delimiter = '') {
    return str.split(delimiter);
}
