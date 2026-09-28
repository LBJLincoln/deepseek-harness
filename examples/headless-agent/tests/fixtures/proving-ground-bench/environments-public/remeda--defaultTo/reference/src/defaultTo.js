import { purry } from "./purry.js";
export function defaultTo(...args) {
    return purry(defaultToImplementation, args);
}
const defaultToImplementation = (data, fallback) => data ?? fallback;
