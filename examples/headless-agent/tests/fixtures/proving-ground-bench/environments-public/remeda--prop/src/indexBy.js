import { purry } from "./purry.js";
export function indexBy(...args) {
    return purry(indexByImplementation, args);
}
function indexByImplementation(data, mapper) {
    const out = {};
    for (const [index, item] of data.entries()) {
        const key = mapper(item, index, data);
        out[key] = item;
    }
    return out;
}
