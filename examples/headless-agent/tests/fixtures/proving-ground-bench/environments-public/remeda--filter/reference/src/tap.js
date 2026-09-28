import { purry } from "./purry.js";
export function tap(...args) {
    return purry(tapImplementation, args);
}
function tapImplementation(value, fn) {
    fn(value);
    return value;
}
