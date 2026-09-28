import { purry } from "./purry.js";
export function pullObject(...args) {
    return purry(pullObjectImplementation, args);
}
function pullObjectImplementation(data, keyExtractor, valueExtractor) {
    const result = {};
    for (const [index, item] of data.entries()) {
        const key = keyExtractor(item, index, data);
        const value = valueExtractor(item, index, data);
        result[key] = value;
    }
    return result;
}
