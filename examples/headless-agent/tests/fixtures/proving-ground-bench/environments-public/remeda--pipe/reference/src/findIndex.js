import { purry } from "./purry.js";
export function findIndex(...args) {
    return purry(findIndexImplementation, args);
}
const findIndexImplementation = (data, predicate) => data.findIndex(predicate);
