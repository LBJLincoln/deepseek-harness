import { purry } from "./purry.js";
export function length(...args) {
    return purry(lengthImplementation, args);
}
const lengthImplementation = (items) => "length" in items ? items.length : [...items].length;
