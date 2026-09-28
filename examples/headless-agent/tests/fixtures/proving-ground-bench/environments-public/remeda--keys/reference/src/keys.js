import { purry } from "./purry.js";
export function keys(...args) {
    return purry(Object.keys, args);
}
