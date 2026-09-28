import { pipe } from "./pipe.js";
export function piped(...functions) {
    return (value) => pipe(value,
    // @ts-expect-error [ts2556] - We can't avoid this error because pipe is typed for users and this is an internal function
    ...functions);
}
