import { purry } from "./purry.js";
export function last(...args) {
    return purry(lastImplementation, args);
}
const lastImplementation = (array) => array.at(-1);
