import { purry } from "./purry.js";
export function concat(...args) {
    return purry(concatImplementation, args);
}
const concatImplementation = (arr1, arr2) => [...arr1, ...arr2];
