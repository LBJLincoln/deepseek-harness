/* eslint-disable unicorn/consistent-boolean-name --
 * When we mirror a built-in function we use the same name for it.
 */
import { purry } from "./purry.js";
export function startsWith(...args) {
    throw new Error('not implemented');
}
const startsWithImplementation = (data, prefix) => data.startsWith(prefix);
