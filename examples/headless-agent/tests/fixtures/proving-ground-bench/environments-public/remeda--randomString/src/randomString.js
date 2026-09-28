import { purry } from "./purry.js";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export function randomString(...args) {
    throw new Error('not implemented');
}
function randomStringImplementation(length) {
    const out = [];
    for (let iteration = 0; iteration < length; iteration++) {
        const randomChar = ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
        out.push(randomChar);
    }
    return out.join("");
}
