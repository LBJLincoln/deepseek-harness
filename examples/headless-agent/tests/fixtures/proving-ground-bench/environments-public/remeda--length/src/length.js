import { purry } from "./purry.js";
export function length(...args) {
    throw new Error('not implemented');
}
const lengthImplementation = (items) => "length" in items ? items.length : [...items].length;
