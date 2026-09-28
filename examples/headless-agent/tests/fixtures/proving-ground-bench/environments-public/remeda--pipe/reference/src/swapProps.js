import { purry } from "./purry.js";
export function swapProps(...args) {
    return purry(swapPropsImplementation, args);
}
const swapPropsImplementation = (obj, key1, key2) => ({
    ...obj,
    [key1]: obj[key2],
    [key2]: obj[key1],
});
