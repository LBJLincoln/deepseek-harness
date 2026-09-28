/* eslint-disable jsdoc/require-param, jsdoc/require-example, jsdoc/require-description -- allow us to deprecate all overloads of the function, not just those that have the docblock directly above them. */
import { purry } from "./purry.js";
// TODO [>2]: Remove this function!
export function pathOr(...args) {
    return purry(pathOrImplementation, args);
}
function pathOrImplementation(data, path, defaultValue) {
    let current = data;
    for (const prop of path) {
        if (current === null || current === undefined) {
            break;
        }
        current = current[prop];
    }
    return current ?? defaultValue;
}
