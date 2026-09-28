import { purry } from "./purry.js";
export function takeLast(...args) {
    return purry(takeLastImplementation, args);
}
const takeLastImplementation = (array, n) => (n > 0 ? array.slice(Math.max(0, array.length - n)) : []);
