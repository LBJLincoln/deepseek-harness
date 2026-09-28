import { withPrecision } from "./internal/withPrecision.js";
import { purry } from "./purry.js";
export function floor(...args) {
    return purry(withPrecision(Math.floor), args);
}
