import { purry } from "./purry.js";
export function sort(...args) {
    return purry(sortImplementation, args);
}
function sortImplementation(items, cmp) {
    const ret = [...items];
    ret.sort(cmp);
    return ret;
}
