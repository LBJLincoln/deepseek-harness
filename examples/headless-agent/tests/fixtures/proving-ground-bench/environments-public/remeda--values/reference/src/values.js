import { purry } from "./purry.js";
export function values(...args) {
    return purry(Object.values, args);
}
