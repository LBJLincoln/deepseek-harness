/* eslint-disable unicorn/consistent-boolean-name --
 * TODO [>2] -- This rule is on-point! The function's name should communicate
 * more clearly that it returns a boolean value.
 */
import { purry } from "./purry.js";
export function allPass(...args) {
    return purry(allPassImplementation, args);
}
const allPassImplementation = (data, fns) => fns.every((fn) => fn(data));
