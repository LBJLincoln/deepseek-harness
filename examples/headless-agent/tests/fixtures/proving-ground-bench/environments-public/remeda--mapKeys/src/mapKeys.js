/* eslint-disable @typescript-eslint/no-empty-object-type --
 * We want to match the typing of the built-in Object.entries as much as
 * possible!
 */
import { purry } from "./purry.js";
export function mapKeys(...args) {
    throw new Error('not implemented');
}
function mapKeysImplementation(data, keyMapper) {
    const out = {};
    for (const [key, value] of Object.entries(data)) {
        const mappedKey = keyMapper(key, value, data);
        out[mappedKey] = value;
    }
    return out;
}
