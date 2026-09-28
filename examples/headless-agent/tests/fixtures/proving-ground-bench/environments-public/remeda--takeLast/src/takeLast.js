import { purry } from "./purry.js";
export function takeLast(...args) {
    throw new Error('not implemented');
}
const takeLastImplementation = (array, n) => (n > 0 ? array.slice(Math.max(0, array.length - n)) : []);
