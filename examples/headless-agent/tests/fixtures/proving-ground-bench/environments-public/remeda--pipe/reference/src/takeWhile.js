import { purry } from "./purry.js";
export function takeWhile(...args) {
    return purry(takeWhileImplementation, args);
}
function takeWhileImplementation(data, predicate) {
    const ret = [];
    for (const [index, item] of data.entries()) {
        if (!predicate(item, index, data)) {
            break;
        }
        ret.push(item);
    }
    return ret;
}
