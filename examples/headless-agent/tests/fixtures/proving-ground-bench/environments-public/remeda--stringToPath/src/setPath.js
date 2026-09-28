import { purry } from "./purry.js";
export function setPath(...args) {
    return purry(setPathImplementation, args);
}
function setPathImplementation(data, path, value) {
    const [pivot, ...rest] = path;
    if (pivot === undefined) {
        return value;
    }
    if (Array.isArray(data)) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const copy = [...data];
        copy[pivot] = setPathImplementation(data[pivot], rest, value);
        return copy;
    }
    const { [pivot]: currentValue, ...remaining } = data;
    return {
        ...remaining,
        [pivot]: setPathImplementation(currentValue, rest, value),
    };
}
