import { purry } from "./purry.js";
export function join(...args) {
    return purry(joinImplementation, args);
}
const joinImplementation = (data, glue) => data.join(glue);
