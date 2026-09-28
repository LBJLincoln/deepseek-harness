import { purry } from "./purry.js";
export function groupByProp(...args) {
    return purry(groupByPropImplementation, args);
}
function groupByPropImplementation(data, prop) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Using Object.create(null) allows us to remove everything from the prototype chain, leaving it as a pure object that only has the keys *we* add to it. This prevents issues like the one raised in #1046
    const output = Object.create(null);
    for (const item of data) {
        const key = item?.[prop];
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- This is incorrect and a result of TypeScript not inferring the type of `key` correctly. It stems from a chain of bad inferences which start with `item` being inferred eagerly as `unknown` (because of: https://github.com/microsoft/TypeScript/issues/61750). When accessing a prop on `unknown` TypeScript then infers the result as `{}[Prop] | undefined`. What follows is that `{}[Prop]` is inferred as `never` (because we are accessing an object with no props defined on it), leading the union to simplify to just `undefined`. The correct type should have been `AllPropValues<T, Prop> | undefined`.
        if (key !== undefined) {
            // Once the prototype chain is fixed, it is safe to access the prop
            // directly without needing to check existence or types.
            const items = output[key];
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Following the problem above, TypeScript then thinks that `key` is `never`, and also types `items` as `never`.
            if (items === undefined) {
                // It is more performant to create a 1-element array over creating an
                // empty array and falling through to a unified the push. It is also
                // more performant to mutate the existing object over using spread to
                // continually create new objects on every unique key.
                // @ts-expect-error [ts7053] -- For the same reasons as mentioned above, TypeScript isn't inferring `key` correctly, and therefore is erroring when trying to access the output object using it.
                output[key] = [item];
            }
            else {
                // It is more performant to add the items to an existing array instead
                // of creating a new array via spreading every time we add an item to
                // it (e.g., `[...current, item]`).
                // @ts-expect-error [ts2339] -- And again here `items` is still `never`.
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- See above.
                items.push(item);
            }
        }
    }
    // Set the prototype as if we initialized our object as a normal object (e.g.
    // `{}`). Without this none of the built-in object methods like `toString`
    // would work on this object and it would act differently than expected.
    Object.setPrototypeOf(output, Object.prototype);
    // @ts-expect-error [ts2322] -- This is fine! We use a broader type for output while we build it because it more accurately represents the shape of the object *while it is being built*. TypeScript can't tell that we finished building the object so can't ensure that output matches the expected output at this point.
    return output;
}
