import { purry } from "./purry.js";
export function countBy(...args) {
    throw new Error('not implemented');
}
const countByImplementation = (data, categorizationFn) => {
    const out = new Map();
    for (const [index, item] of data.entries()) {
        const category = categorizationFn(item, index, data);
        if (category !== undefined) {
            const count = out.get(category);
            if (count === undefined) {
                out.set(category, 1);
            }
            else {
                out.set(category, count + 1);
            }
        }
    }
    return Object.fromEntries(out);
};
