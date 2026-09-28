import { toLowerCase } from "../native/to-lower-case.js";
import { capitalize } from "../utils/word-case/capitalize.js";
/**
 * This is an enhanced version of the typeof operator to check the type of more complex values.
 * In this case we just mind about arrays and objects. We can add more on demand.
 * @param t the value to be checked
 * @returns the type of the value
 */
function typeOf(t) {
    throw new Error('not implemented');
}
function pascalCaseAll(words) {
    return words.map((v) => capitalize(toLowerCase(v)));
}
export { pascalCaseAll, typeOf };
