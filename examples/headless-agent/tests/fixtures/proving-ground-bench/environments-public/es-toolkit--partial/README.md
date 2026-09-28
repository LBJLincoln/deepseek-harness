# Implement partial from es-toolkit

`src/function/partial.js` is the JavaScript build of `src/function/partial.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `partial`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates a function that invokes `func` with `partialArgs` prepended to the arguments it receives. This method is like `bind` except it does not alter the `this` binding.
 *
 * The partial.placeholder value, which defaults to a `symbol`, may be used as a placeholder for partially applied arguments.
 *
 * Note: This method doesn't set the `length` property of partially applied functions.
 *
 * @template F The type of the function to partially apply.
 * @param func The function to partially apply arguments to.
 * @param partialArgs The arguments to be partially applied.
 * @returns Returns the new partially applied function.
 *
 * @example
 * function greet(greeting, name) {
 *   return greeting + ' ' + name;
 * }
 *
 * const sayHelloTo = partial(greet, 'hello');
 * sayHelloTo('fred');
 * // => 'hello fred'
 *
 * // Partially applied with placeholders.
 * const greetFred = partial(greet, partial.placeholder, 'fred');
 * greetFred('hi');
 * // => 'hi fred'
 */
export function partial<F extends (...args: any[]) => any>(
  func: F,
  ...partialArgs: any[]
): (...args: any[]) => ReturnType<F>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/compat/function/curry.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/function/partial.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/function/partial.js` erased them.

```ts
type Placeholder = typeof placeholderSymbol;
```
