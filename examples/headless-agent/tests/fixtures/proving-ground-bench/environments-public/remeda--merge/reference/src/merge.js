import { purry } from "./purry.js";
export function merge(...args) {
    return purry(mergeImplementation, args);
}
const mergeImplementation = (data, source) => ({ ...data, ...source });
