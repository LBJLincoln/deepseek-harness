import { purry } from "./purry.js";
export function splitAt(...args) {
    throw new Error('not implemented');
}
function splitAtImplementation(array, index) {
    const effectiveIndex = Math.max(Math.min(index < 0 ? array.length + index : index, array.length), 0);
    return [array.slice(0, effectiveIndex), array.slice(effectiveIndex)];
}
