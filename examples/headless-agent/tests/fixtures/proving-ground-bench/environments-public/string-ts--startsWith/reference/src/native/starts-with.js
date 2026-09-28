/**
 * A strongly-typed version of `String.prototype.startsWith`.
 * @param text the string to search.
 * @param search the string to search with.
 * @param position the index to start search at.
 * @returns boolean, whether or not the text string starts with the search string.
 * @example startsWith('abc', 'a') // true
 */
export function startsWith(text, search, position = 0) {
    return text.startsWith(search, position);
}
