import { purry } from "./purry.js";
export function addProp(...args) {
    return purry(addPropImplementation, args);
}
const addPropImplementation = (obj, prop, value) =>
// @ts-expect-error [ts2322] - Hard to type...
({ ...obj, [prop]: value });
