import { purry } from "./purry.js";
export function chunk(...args) {
    return purry(chunkImplementation, args);
}
function chunkImplementation(data, size) {
    if (size < 1) {
        throw new RangeError(`chunk: A chunk size of '${size.toString()}' would result in an infinite array`);
    }
    if (data.length === 0) {
        return [];
    }
    if (size >= data.length) {
        // Optimized for when there is only one chunk.
        return [[...data]];
    }
    const chunks = Math.ceil(data.length / size);
    // eslint-disable-next-line unicorn/no-new-array -- This is OK, a sparse array allows us to handle very large arrays more efficiently.
    const result = new Array(chunks);
    if (size === 1) {
        // Optimized for when we don't need slice.
        for (const [index, item] of data.entries()) {
            result[index] = [item];
        }
    }
    else {
        for (let index = 0; index < chunks; index += 1) {
            const start = index * size;
            result[index] = data.slice(start, start + size);
        }
    }
    return result;
}
