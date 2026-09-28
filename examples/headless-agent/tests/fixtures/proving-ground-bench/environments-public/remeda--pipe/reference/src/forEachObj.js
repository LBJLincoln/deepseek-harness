import { purry } from "./purry.js";
export function forEachObj(...args) {
    return purry(forEachObjImplementation, args);
}
function forEachObjImplementation(data, fn) {
    for (const [key, value] of Object.entries(data)) {
        fn(value, key, data);
    }
    return data;
}
