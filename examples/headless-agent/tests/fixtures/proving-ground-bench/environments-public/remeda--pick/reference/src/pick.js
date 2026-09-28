import { purry } from "./purry.js";
export function pick(...args) {
    return purry(pickImplementation, args);
}
function pickImplementation(object, keys) {
    const out = {};
    for (const key of keys) {
        // eslint-disable-next-line unicorn/no-computed-property-existence-check -- The prototype-chain check is intentional: for class instances the picked keys (methods and accessors) live on the prototype, and `Object.hasOwn` would wrongly skip them (https://github.com/remeda/remeda/issues/107).
        if (key in object) {
            out[key] = object[key];
        }
    }
    // @ts-expect-error [ts2322] - We build the type incrementally, there's no way to make typescript infer that we "finished" building the object and to treat it as such.
    return out;
}
