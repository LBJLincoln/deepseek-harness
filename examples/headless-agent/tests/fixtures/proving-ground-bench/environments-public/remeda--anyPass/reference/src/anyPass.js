/* eslint-disable unicorn/consistent-boolean-name --
 * TODO [>2] -- This rule is on-point! The function's name should communicate
 * more clearly that it returns a boolean value.
 */
import { purry } from "./purry.js";
export function anyPass(...args) {
    return purry(anyPassImplementation, args);
}
const anyPassImplementation = (data, fns) => fns.some((fn) => fn(data));
