import { join } from "../native/join.js";
/**
 * A strongly typed function to truncate a string if it's longer than the given maximum string length.
 * The last characters of the truncated string are replaced with the omission string which defaults to "...".
 * @param sentence the sentence to extract the words from.
 * @param length the maximum length of the string.
 * @param omission the string to append to the end of the truncated string.
 * @returns the truncated string
 * @example truncate('Hello, World', 8) // 'Hello...'
 */
export function truncate(sentence, length, omission = '...') {
    throw new Error('not implemented');
}
