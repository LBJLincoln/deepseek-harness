import { purry } from "./purry.js";
export function entries(...args) {
    return purry(Object.entries, args);
}
