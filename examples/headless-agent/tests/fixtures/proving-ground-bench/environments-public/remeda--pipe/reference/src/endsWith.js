/* eslint-disable unicorn/consistent-boolean-name --
 * When we mirror a built-in function we use the same name for it.
 */
import { purry } from "./purry.js";
export function endsWith(...args) {
    return purry(endsWithImplementation, args);
}
const endsWithImplementation = (data, suffix) => data.endsWith(suffix);
