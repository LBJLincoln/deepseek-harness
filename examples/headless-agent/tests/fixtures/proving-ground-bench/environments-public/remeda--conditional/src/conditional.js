/* eslint-disable jsdoc/check-param-names, jsdoc/require-param --
 * We don't document each `case` param, instead we document the concept more
 * generally, but these eslint rules can't detect that.
 */
import { purryOn } from "./internal/purryOn.js";
export function conditional(...args) {
    throw new Error('not implemented');
}
function conditionalImplementation(data, ...cases) {
    for (const current of cases) {
        if (typeof current === "function") {
            return current(data);
        }
        const [when, then] = current;
        if (when(data)) {
            return then(data);
        }
    }
    // TODO [>2]: When we built this function originally we didn't want to have to always return `undefined` and force users to always have to handle that case even when they knew it would never happen. In hindsight that was wrong and we can support this at the type-level without throwing. If users want to throw they can always have an explicit fallback that does that (and we might add a throw utility in v3 too!).
    throw new Error("conditional: data failed for all cases");
}
function isCase(maybeCase) {
    if (!Array.isArray(maybeCase)) {
        return false;
    }
    const [when, then, ...rest] = maybeCase;
    return (typeof when === "function" &&
        when.length <= 1 &&
        typeof then === "function" &&
        then.length <= 1 &&
        rest.length === 0);
}
