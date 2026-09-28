# Implement gammaln from simple-statistics

`src/gammaln.js` is the JavaScript build of `src/gammaln.js` from simple-statistics (https://github.com/simple-statistics/simple-statistics at commit 5ee3e8be581f, ISC licence, whose text is in `LICENSE`). Every export of the module is in place except `gammaln`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * Compute the logarithm of the [gamma function](https://en.wikipedia.org/wiki/Gamma_function) of a value using Lanczos' approximation.
 * This function takes as input any real-value n greater than 0.
 * This function is useful for values of n too large for the normal gamma function (n > 165).
 * The code is based on Lanczo's Gamma approximation, defined [here](http://my.fit.edu/~gabdo/gamma.txt).
 *
 * @param {number} n Any real number greater than zero.
 * @returns {number} The logarithm of gamma of the input value.
 *
 * @example
 * gammaln(500); // 2605.1158503617335
 * gammaln(2.4); // 0.21685932244884043
 */
function gammaln(n)

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/factorial.js`, `src/gamma.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/gammaln.js` of simple-statistics (https://github.com/simple-statistics/simple-statistics) at commit `5ee3e8be581ffd4a4b372d5da11cda8c53a0e6bd`, distributed under the ISC licence (Copyright (c) 2014, Tom MacWright); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.
