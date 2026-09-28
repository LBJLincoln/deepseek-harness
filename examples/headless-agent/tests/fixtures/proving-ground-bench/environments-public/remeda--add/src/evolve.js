import { purry } from "./purry.js";
export function evolve(...args) {
    return purry(evolveImplementation, args);
}
function evolveImplementation(data, evolver) {
    if (typeof data !== "object" || data === null) {
        return data;
    }
    const out = { ...data };
    for (const [key, value] of Object.entries(evolver)) {
        if (Object.hasOwn(out, key)) {
            out[key] =
                typeof value === "function"
                    ? value(out[key])
                    : evolveImplementation(out[key], value);
        }
    }
    return out;
}
