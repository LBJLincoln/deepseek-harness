import { purry } from "./purry.js";
export function capitalize(...args) {
    return purry(capitalizeImplementation, args);
}
const capitalizeImplementation = (data) => `${data[0]?.toUpperCase() ?? ""}${data.slice(1)}`;
