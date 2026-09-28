import { isDeepEqual } from "./isDeepEqual.js";
import { purry } from "./purry.js";
export function hasSubObject(...args) {
    return purry(hasSubObjectImplementation, args);
}
function hasSubObjectImplementation(data, subObject) {
    for (const [key, value] of Object.entries(subObject)) {
        if (!Object.hasOwn(data, key)) {
            return false;
        }
        if (!isDeepEqual(value, data[key])) {
            return false;
        }
    }
    return true;
}
