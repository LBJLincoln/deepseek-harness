import { purry } from "./purry.js";
export function mapValues(...args) {
    return purry(mapValuesImplementation, args);
}
function mapValuesImplementation(data, valueMapper) {
    const out = {};
    for (const [key, value] of Object.entries(data)) {
        const mappedValue = valueMapper(value, key, data);
        out[key] = mappedValue;
    }
    return out;
}
