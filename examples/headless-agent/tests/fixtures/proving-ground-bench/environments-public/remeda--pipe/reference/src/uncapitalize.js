import { purry } from "./purry.js";
export function uncapitalize(...args) {
    return purry(uncapitalizeImplementation, args);
}
const uncapitalizeImplementation = (data) => `${data[0]?.toLowerCase() ?? ""}${data.slice(1)}`;
