import { purry } from "./purry.js";
export function only(...args) {
    return purry(onlyImplementation, args);
}
const onlyImplementation = (data) => data.length === 1 ? data[0] : undefined;
