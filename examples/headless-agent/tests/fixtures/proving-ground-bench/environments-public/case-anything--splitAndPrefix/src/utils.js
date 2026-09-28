// Latin-1 Supplement
// upper case ranges
// [À-ÖØ-ß]
// lower case ranges
// [à-öø-ÿ]
export const magicSplit = /^[a-zà-öø-ÿа-я]+|[A-ZÀ-ÖØ-ßА-Я][a-zà-öø-ÿа-я]+|[a-zà-öø-ÿа-я]+|[0-9]+|[A-ZÀ-ÖØ-ßА-Я]+(?![a-zà-öø-ÿа-я])/g;
export const spaceSplit = /\S+/g;
/**
 * A string.matchAll function that will return an array of "string parts" and the indexes at which
 * it split each part
 */
export function getPartsAndIndexes(string, splitRegex) {
    const result = { parts: [], prefixes: [] };
    const matches = string.matchAll(splitRegex);
    let lastWordEndIndex = 0;
    for (const match of matches) {
        if (typeof match.index !== 'number')
            continue;
        const word = match[0];
        result.parts.push(word);
        const prefix = string.slice(lastWordEndIndex, match.index).trim();
        result.prefixes.push(prefix);
        lastWordEndIndex = match.index + word.length;
    }
    const tail = string.slice(lastWordEndIndex).trim();
    if (tail) {
        result.parts.push('');
        result.prefixes.push(tail);
    }
    return result;
}
/**
 * A function that splits a string on words and returns an array of words.
 *
 * - It can prefix each word with a given character
 * - It can strip or keep special characters, this affects the logic for adding a prefix as well
 */
export function splitAndPrefix(string, options) {
    throw new Error('not implemented');
}
/**
 * Capitalises a single word
 *
 * @returns The word with the first character in uppercase and the rest in lowercase
 */
export function capitaliseWord(string) {
    const match = string.matchAll(magicSplit).next().value;
    const firstLetterIndex = match ? match.index : 0;
    return (string.slice(0, firstLetterIndex + 1).toUpperCase() +
        string.slice(firstLetterIndex + 1).toLowerCase());
}
