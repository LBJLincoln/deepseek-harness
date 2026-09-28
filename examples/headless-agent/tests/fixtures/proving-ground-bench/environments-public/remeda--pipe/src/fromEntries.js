import { purry } from "./purry.js";
export function fromEntries(...args) {
    return purry(Object.fromEntries, args);
}
