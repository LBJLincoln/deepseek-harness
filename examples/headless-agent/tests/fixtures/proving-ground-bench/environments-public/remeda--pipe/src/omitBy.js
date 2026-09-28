import { purry } from "./purry.js";
export function omitBy(...args) {
    return purry(omitByImplementation, args);
}
function omitByImplementation(data, predicate) {
    const out = { ...data };
    for (const [key, value] of Object.entries(out)) {
        if (predicate(value, key, data)) {
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- This is the best way to do it!
            delete out[key];
        }
    }
    return out;
}
