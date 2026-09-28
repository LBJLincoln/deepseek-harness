import { purry } from "./purry.js";
export function sort(...args) {
    throw new Error('not implemented');
}
function sortImplementation(items, cmp) {
    const ret = [...items];
    ret.sort(cmp);
    return ret;
}
