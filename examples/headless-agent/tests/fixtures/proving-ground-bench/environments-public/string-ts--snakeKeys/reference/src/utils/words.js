import { SEPARATOR_REGEX } from "./characters/separators.js";
/**
 * A strongly-typed function to extract the words from a sentence.
 * @param sentence the sentence to extract the words from.
 * @returns an array of words in both type level and runtime.
 * @example words('helloWorld') // ['hello', 'World']
 */
export function words(sentence) {
    return sentence
        .replace(SEPARATOR_REGEX, ' ') // Step 1: Remove separators
        .replace(/([a-zA-Z])([0-9])/g, '$1 $2') // Step 2: From non-digit to digit
        .replace(/([0-9])([a-zA-Z])/g, '$1 $2') // Step 3: From digit to non-digit
        .replace(/([a-zA-Z0-9_\-./])([^a-zA-Z0-9_\-./'])/g, '$1 $2') // Step 4: From non-special to special
        .replace(/([^a-zA-Z0-9_\-./'])([a-zA-Z0-9_\-./])/g, '$1 $2') // Step 5: From special to non-special
        .replace(/([a-z])([A-Z])/g, '$1 $2') // Step 6: From lower to upper
        .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2') // Step 7: From upper to upper and lower
        .trim() // Step 8: Trim the last word
        .split(/\s+/g);
}
