import { withPrecision } from "./internal/withPrecision.js";
import { purry } from "./purry.js";
export function ceil(...args) {
    return purry(withPrecision(Math.ceil), args);
}
