import { purry } from "./purry.js";
export function hasAtLeast(...args) {
    return purry(hasAtLeastImplementation, args);
}
const hasAtLeastImplementation = (data, minimum) => data.length >= minimum;
