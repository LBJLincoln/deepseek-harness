# Implement curry from es-toolkit

`src/compat/function/curry.js` is the JavaScript build of `src/compat/function/curry.ts` from es-toolkit (https://github.com/toss/es-toolkit at commit d6f796064886, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `curry`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Creates a function that accepts arguments of `func` and either invokes `func` returning its result, if at least `arity` number of arguments have been provided, or returns a function that accepts the remaining `func` arguments, and so on.
 * The arity of `func` may be specified if `func.length` is not sufficient.
 *
 * The `curry.placeholder` value, which defaults to a `symbol`, may be used as a placeholder for partially applied arguments.
 *
 * Note: This method doesn't set the `length` property of curried functions.
 *
 * @param func - The function to curry.
 * @param arity - The arity of func.
 * @param guard - Enables use as an iteratee for methods like `Array#map`.
 * @returns} - Returns the new curried function.
 *
 * @example
 * const abc = function(a, b, c) {
 *   return Array.from(arguments);
 * };
 *
 * let curried = curry(abc);
 *
 * curried(1)(2)(3);
 * // => [1, 2, 3]
 *
 * curried(1, 2)(3);
 * // => [1, 2, 3]
 *
 * curried(1, 2, 3);
 * // => [1, 2, 3]
 *
 * // Curried with placeholders.
 * curried(1)(curry.placeholder, 3)(2);
 * // => [1, 2, 3]
 *
 * // Curried with arity.
 * curried = curry(abc, 2);
 *
 * curried(1)(2);
 * // => [1, 2]
 */
export function curry(
  func: (...args: any[]) => any,
  arity: number = func.length,
  guard?: unknown
): ((...args: any[]) => any) & { placeholder: typeof curry.placeholder }

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/_internal/globalThis.js`, `src/_internal/isUnsafeProperty.js`, `src/array/head.js`, `src/array/uniq.js`, `src/compat/_internal/baseToString.js`, `src/compat/_internal/getSymbols.js`, `src/compat/_internal/getTag.js`, `src/compat/_internal/isDeepKey.js`, `src/compat/_internal/isIndex.js`, `src/compat/_internal/tags.js`, `src/compat/_internal/toKey.js`, `src/compat/array/map.js`, `src/compat/object/cloneDeep.js`, `src/compat/object/cloneDeepWith.js`, `src/compat/object/get.js`, `src/compat/object/has.js`, `src/compat/object/property.js`, `src/compat/predicate/isArguments.js`, `src/compat/predicate/isArrayLike.js`, `src/compat/predicate/isMatch.js`, `src/compat/predicate/isMatchWith.js`, `src/compat/predicate/isObject.js`, `src/compat/predicate/isSymbol.js`, `src/compat/predicate/matches.js`, `src/compat/predicate/matchesProperty.js`, `src/compat/util/eq.js`, `src/compat/util/iteratee.js`, `src/compat/util/toPath.js`, `src/compat/util/toString.js`, `src/function/ary.js`, `src/function/flow.js`, `src/function/flowRight.js`, `src/function/identity.js`, `src/function/partial.js`, `src/function/partialRight.js`, `src/math/range.js`, `src/object/cloneDeep.js`, `src/object/cloneDeepWith.js`, `src/predicate/isBuffer.js`, `src/predicate/isLength.js`, `src/predicate/isPrimitive.js`, `src/predicate/isTypedArray.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/compat/function/curry.ts` of es-toolkit (https://github.com/toss/es-toolkit) at commit `d6f796064886b6229385c5f3e6165dab584ebfb6`, distributed under the MIT licence (Copyright (c) 2024 Viva Republica, Inc.); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/compat/function/curry.js` erased them.

```ts
type __ = typeof curryPlaceholder;

interface CurriedFunction1<T1, R> {
  (): CurriedFunction1<T1, R>;
  (t1: T1): R;
}

interface CurriedFunction2<T1, T2, R> {
  (): CurriedFunction2<T1, T2, R>;
  (t1: T1): CurriedFunction1<T2, R>;
  (t1: __, t2: T2): CurriedFunction1<T1, R>;
  (t1: T1, t2: T2): R;
}

interface CurriedFunction3<T1, T2, T3, R> {
  (): CurriedFunction3<T1, T2, T3, R>;
  (t1: T1): CurriedFunction2<T2, T3, R>;
  (t1: __, t2: T2): CurriedFunction2<T1, T3, R>;
  (t1: T1, t2: T2): CurriedFunction1<T3, R>;
  (t1: __, t2: __, t3: T3): CurriedFunction2<T1, T2, R>;
  (t1: T1, t2: __, t3: T3): CurriedFunction1<T2, R>;
  (t1: __, t2: T2, t3: T3): CurriedFunction1<T1, R>;
  (t1: T1, t2: T2, t3: T3): R;
}

interface CurriedFunction4<T1, T2, T3, T4, R> {
  (): CurriedFunction4<T1, T2, T3, T4, R>;
  (t1: T1): CurriedFunction3<T2, T3, T4, R>;
  (t1: __, t2: T2): CurriedFunction3<T1, T3, T4, R>;
  (t1: T1, t2: T2): CurriedFunction2<T3, T4, R>;
  (t1: __, t2: __, t3: T3): CurriedFunction3<T1, T2, T4, R>;
  (t1: __, t2: __, t3: T3): CurriedFunction2<T2, T4, R>;
  (t1: __, t2: T2, t3: T3): CurriedFunction2<T1, T4, R>;
  (t1: T1, t2: T2, t3: T3): CurriedFunction1<T4, R>;
  (t1: __, t2: __, t3: __, t4: T4): CurriedFunction3<T1, T2, T3, R>;
  (t1: T1, t2: __, t3: __, t4: T4): CurriedFunction2<T2, T3, R>;
  (t1: __, t2: T2, t3: __, t4: T4): CurriedFunction2<T1, T3, R>;
  (t1: __, t2: __, t3: T3, t4: T4): CurriedFunction2<T1, T2, R>;
  (t1: T1, t2: T2, t3: __, t4: T4): CurriedFunction1<T3, R>;
  (t1: T1, t2: __, t3: T3, t4: T4): CurriedFunction1<T2, R>;
  (t1: __, t2: T2, t3: T3, t4: T4): CurriedFunction1<T1, R>;
  (t1: T1, t2: T2, t3: T3, t4: T4): R;
}

interface CurriedFunction5<T1, T2, T3, T4, T5, R> {
  (): CurriedFunction5<T1, T2, T3, T4, T5, R>;
  (t1: T1): CurriedFunction4<T2, T3, T4, T5, R>;
  (t1: __, t2: T2): CurriedFunction4<T1, T3, T4, T5, R>;
  (t1: T1, t2: T2): CurriedFunction3<T3, T4, T5, R>;
  (t1: __, t2: __, t3: T3): CurriedFunction4<T1, T2, T4, T5, R>;
  (t1: T1, t2: __, t3: T3): CurriedFunction3<T2, T4, T5, R>;
  (t1: __, t2: T2, t3: T3): CurriedFunction3<T1, T4, T5, R>;
  (t1: T1, t2: T2, t3: T3): CurriedFunction2<T4, T5, R>;
  (t1: __, t2: __, t3: __, t4: T4): CurriedFunction4<T1, T2, T3, T5, R>;
  (t1: T1, t2: __, t3: __, t4: T4): CurriedFunction3<T2, T3, T5, R>;
  (t1: __, t2: T2, t3: __, t4: T4): CurriedFunction3<T1, T3, T5, R>;
  (t1: __, t2: __, t3: T3, t4: T4): CurriedFunction3<T1, T2, T5, R>;
  (t1: T1, t2: T2, t3: __, t4: T4): CurriedFunction2<T3, T5, R>;
  (t1: T1, t2: __, t3: T3, t4: T4): CurriedFunction2<T2, T5, R>;
  (t1: __, t2: T2, t3: T3, t4: T4): CurriedFunction2<T1, T5, R>;
  (t1: T1, t2: T2, t3: T3, t4: T4): CurriedFunction1<T5, R>;
  (t1: __, t2: __, t3: __, t4: __, t5: T5): CurriedFunction4<T1, T2, T3, T4, R>;
  (t1: T1, t2: __, t3: __, t4: __, t5: T5): CurriedFunction3<T2, T3, T4, R>;
  (t1: __, t2: T2, t3: __, t4: __, t5: T5): CurriedFunction3<T1, T3, T4, R>;
  (t1: __, t2: __, t3: T3, t4: __, t5: T5): CurriedFunction3<T1, T2, T4, R>;
  (t1: __, t2: __, t3: __, t4: T4, t5: T5): CurriedFunction3<T1, T2, T3, R>;
  (t1: T1, t2: T2, t3: __, t4: __, t5: T5): CurriedFunction2<T3, T4, R>;
  (t1: T1, t2: __, t3: T3, t4: __, t5: T5): CurriedFunction2<T2, T4, R>;
  (t1: T1, t2: __, t3: __, t4: T4, t5: T5): CurriedFunction2<T2, T3, R>;
  (t1: __, t2: T2, t3: T3, t4: __, t5: T5): CurriedFunction2<T1, T4, R>;
  (t1: __, t2: T2, t3: __, t4: T4, t5: T5): CurriedFunction2<T1, T3, R>;
  (t1: __, t2: __, t3: T3, t4: T4, t5: T5): CurriedFunction2<T1, T2, R>;
  (t1: T1, t2: T2, t3: T3, t4: __, t5: T5): CurriedFunction1<T4, R>;
  (t1: T1, t2: T2, t3: __, t4: T4, t5: T5): CurriedFunction1<T3, R>;
  (t1: T1, t2: __, t3: T3, t4: T4, t5: T5): CurriedFunction1<T2, R>;
  (t1: __, t2: T2, t3: T3, t4: T4, t5: T5): CurriedFunction1<T1, R>;
  (t1: T1, t2: T2, t3: T3, t4: T4, t5: T5): R;
}
```
