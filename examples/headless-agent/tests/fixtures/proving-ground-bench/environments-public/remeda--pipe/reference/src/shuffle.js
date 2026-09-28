import { purry } from "./purry.js";
export function shuffle(...args) {
    return purry(shuffleImplementation, args);
}
function shuffleImplementation(items) {
    const result = [...items];
    for (let index = 0; index < items.length; index++) {
        const rand = index + Math.floor(Math.random() * (items.length - index));
        const value = result[rand];
        result[rand] = result[index];
        result[index] = value;
    }
    return result;
}
