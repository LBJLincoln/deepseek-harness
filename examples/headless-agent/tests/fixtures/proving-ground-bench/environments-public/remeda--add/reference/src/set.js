import { purry } from "./purry.js";
export function set(...args) {
    return purry(setImplementation, args);
}
const setImplementation = (obj, prop, value) =>
// @ts-expect-error [ts2322] - Hard to type
({ ...obj, [prop]: value });
