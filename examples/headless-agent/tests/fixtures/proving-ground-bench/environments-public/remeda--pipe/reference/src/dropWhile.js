import { purry } from "./purry.js";
export function dropWhile(...args) {
    return purry(dropWhileImplementation, args);
}
function dropWhileImplementation(data, predicate) {
    for (const [index, item] of data.entries()) {
        if (!predicate(item, index, data)) {
            return data.slice(index);
        }
    }
    return [];
}
