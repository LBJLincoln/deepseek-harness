/* eslint-disable unicorn/consistent-boolean-name --
 * When we mirror a built-in function we use the same name for it.
 */
import { purry } from "./purry.js";
export function endsWith(...args) {
    throw new Error('not implemented');
}
const endsWithImplementation = (data, suffix) => data.endsWith(suffix);
