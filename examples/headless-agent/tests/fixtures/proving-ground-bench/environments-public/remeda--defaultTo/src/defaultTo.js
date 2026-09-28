import { purry } from "./purry.js";
export function defaultTo(...args) {
    throw new Error('not implemented');
}
const defaultToImplementation = (data, fallback) => data ?? fallback;
