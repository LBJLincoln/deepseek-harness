import { withPrecision } from "./internal/withPrecision.js";
import { purry } from "./purry.js";
export function round(...args) {
    return purry(withPrecision(Math.round), args);
}
