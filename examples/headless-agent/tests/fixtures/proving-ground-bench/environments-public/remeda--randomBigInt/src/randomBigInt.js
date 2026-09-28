/* eslint-disable no-bitwise, @typescript-eslint/no-magic-numbers --
 * We randomize the bigint using randomized bitmaps, we have to use bitwise
 * operations to manipulate them.
 */
/**
 * Generate a random `bigint` between `from` and `to` (inclusive).
 *
 * ! Important: In most environments this function uses
 * [`crypto.getRandomValues()`](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues)
 * under-the-hood which **is** cryptographically strong. When the WebCrypto API
 * isn't available (Node 18) we fallback to an implementation that uses
 * [`Math.random()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/random)
 * which is **NOT** cryptographically secure.
 *
 * @param from - The minimum value.
 * @param to - The maximum value.
 * @returns The random integer.
 * @signature
 *   randomBigInt(from, to)
 * @example
 *   randomBigInt(1n, 10n) // => 5n
 * @dataFirst
 * @category Number
 */
export function randomBigInt(from, to) {
    throw new Error('not implemented');
}
function asBigInt(bytes) {
    let result = 0n;
    for (const byte of bytes) {
        // We build the bigint by shifting the current value by a byte, and putting
        // the next byte in that "slot".
        result = (result << 8n) + BigInt(byte);
    }
    return result;
}
function random(numBytes) {
    const output = new Uint8Array(numBytes);
    if (typeof crypto === "undefined") {
        // Polyfill for environments without `crypto` support. The only env which
        // requires this and we support is Node 18; once we drop support for it we
        // can drop the polyfill.
        for (let index = 0; index < numBytes; index += 1) {
            output[index] = Math.floor(Math.random() * 256);
        }
    }
    else {
        crypto.getRandomValues(output);
    }
    return output;
}
