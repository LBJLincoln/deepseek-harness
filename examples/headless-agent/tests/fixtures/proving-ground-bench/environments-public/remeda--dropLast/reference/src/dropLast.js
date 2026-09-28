import { purry } from "./purry.js";
export function dropLast(...args) {
    return purry(dropLastImplementation, args);
}
const dropLastImplementation = (array, n) => n > 0 ? array.slice(0, Math.max(0, array.length - n)) : [...array];
