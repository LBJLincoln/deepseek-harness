import { purry } from "./purry.js";
export function objOf(...args) {
    return purry(objOfImplementation, args);
}
const objOfImplementation = (value, key) =>
// @ts-expect-error [ts2322] - I'm not sure how to get the type right here...
({ [key]: value });
