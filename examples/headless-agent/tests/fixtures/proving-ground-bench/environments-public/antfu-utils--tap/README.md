# Implement tap from antfu-utils

`src/function.js` is the JavaScript build of `src/function.ts` from antfu-utils (https://github.com/antfu/utils at commit 91f8cf73bebd, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `tap`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Pass the value through the callback, and return the value
 *
 * @example
 * ```
 * function createUser(name: string): User {
 *   return tap(new User, user => {
 *     user.name = name
 *   })
 * }
 * ```
 */
export function tap<T>(value: T, callback: (value: T) => void): T

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/function.ts` of antfu-utils (https://github.com/antfu/utils) at commit `91f8cf73bebddae8f7ebcac82e47c9bcba9805e2`, distributed under the MIT licence (Copyright (c) 2021 Anthony Fu <https://github.com/antfu>); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
