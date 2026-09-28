import { purryFromLazy } from "./internal/purryFromLazy.js";
import { SKIP_ITEM } from "./internal/utilityEvaluators.js";
export function unique(...args) {
    return purryFromLazy(lazyImplementation, args);
}
function lazyImplementation() {
    const set = new Set();
    return (value) => {
        if (set.has(value)) {
            return SKIP_ITEM;
        }
        set.add(value);
        return { done: false, hasNext: true, next: value };
    };
}
