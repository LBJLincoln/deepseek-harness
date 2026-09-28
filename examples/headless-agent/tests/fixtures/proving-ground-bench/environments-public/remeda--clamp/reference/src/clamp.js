import { purry } from "./purry.js";
export function clamp(...args) {
    return purry(clampImplementation, args);
}
const clampImplementation = (value, { min, max }) => min !== undefined && value < min
    ? min
    : max !== undefined && value > max
        ? max
        : value;
