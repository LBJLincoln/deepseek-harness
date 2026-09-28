import { toLowerCase } from "../native/to-lower-case.js";
import { capitalize } from "../utils/word-case/capitalize.js";
/**
 * This is an enhanced version of the typeof operator to check the type of more complex values.
 * In this case we just mind about arrays and objects. We can add more on demand.
 * @param t the value to be checked
 * @returns the type of the value
 */
function typeOf(t) {
    return Object.prototype.toString
        .call(t)
        .replace(/^\[object (.+)\]$/, '$1')
        .toLowerCase();
}
function pascalCaseAll(words) {
    return words.map((v) => capitalize(toLowerCase(v)));
}
export { pascalCaseAll, typeOf };
