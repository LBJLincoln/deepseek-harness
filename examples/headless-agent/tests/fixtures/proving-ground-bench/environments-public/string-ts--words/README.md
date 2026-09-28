# Implement words from string-ts

`src/utils/words.js` is the JavaScript build of `src/utils/words.ts` from string-ts (https://github.com/gustavoguichard/string-ts at commit 7850efd6baba, MIT licence, whose text is in `LICENSE`). Every export of the module is in place except `words`, whose body currently throws 'not implemented'. Implement only that function's body so that it fulfills its own documentation, which the source carries as follows:

/**
 * A strongly-typed function to extract the words from a sentence.
 * @param sentence the sentence to extract the words from.
 * @returns an array of words in both type level and runtime.
 * @example words('helloWorld') // ['hello', 'World']
 */
export function words<T extends string>(sentence: T): Words<T>

Keep the signature exactly as given, and do not edit any other file, export, or function; `README.md` states the types the signature and the documentation name. The other files under `src/` (`src/utils/characters/separators.js`) are the module's own dependencies, unchanged; read them as you need, edit none. Add no dependencies: `package.json` is fixed and `node_modules` must not exist. This task is judged on inputs you do not see: a validator runs the module's own test suite, which this workspace does not contain, against your implementation. `test/expect-shim.mjs` is the assertion library those cases run under; it holds no case and is fixed. Implement the documented contract, including every corner it states, rather than the behaviour a guessed test would pin down.

## Attribution

This task is derived from `src/utils/words.ts` of string-ts (https://github.com/gustavoguichard/string-ts) at commit `7850efd6baba551d60e4b85a2e4a8ed075167bb5`, distributed under the MIT licence (Copyright (c) 2023 Gustavo Guichard); the licence text is kept in `LICENSE` and accompanies every copy of this task and anything derived from it.

## Types the module declares

The module's TypeScript source declares these types; the JavaScript build in `src/utils/words.js` erased them.

```ts
/**
 * Splits a string into words.
 * sentence: The current string to split.
 * word: The current word.
 * prev: The previous character.
 */
export type Words<
  sentence extends string,
  word extends string = '',
  prev extends string = '',
> = IsStringLiteral<sentence | word | prev> extends true
  ? sentence extends `${infer curr}${infer rest}`
    ? IsSeparator<curr> extends true
      ? // Step 1: Remove separators
        Reject<[word, ...Words<rest>], ''>
      : prev extends ''
        ? // Start of sentence, start a new word
          Reject<Words<rest, curr, curr>, ''>
        : [false, true] extends [IsDigit<prev>, IsDigit<curr>]
          ? // Step 2: From non-digit to digit
            [word, ...Words<rest, curr, curr>]
          : [true, false] extends [IsDigit<prev>, IsDigit<curr>]
            ? // Step 3: From digit to non-digit
              [word, ...Words<rest, curr, curr>]
            : [false, true] extends [IsSpecial<prev>, IsSpecial<curr>]
              ? // Step 4: From non-special to special
                [word, ...Words<rest, curr, curr>]
              : [true, false] extends [IsSpecial<prev>, IsSpecial<curr>]
                ? // Step 5: From special to non-special
                  [word, ...Words<rest, curr, curr>]
                : [true, true] extends [IsDigit<prev>, IsDigit<curr>]
                  ? // If both are digit, continue with the sentence
                    Reject<Words<rest, `${word}${curr}`, curr>, ''>
                  : [true, true] extends [IsLower<prev>, IsUpper<curr>]
                    ? // Step 6: From lower to upper
                      [word, ...Words<rest, curr, curr>]
                    : [true, true] extends [IsUpper<prev>, IsLower<curr>]
                      ? // Step 7: From upper to upper and lower
                        // Remove the last character from the current word and start a new word with it
                        [
                          DropSuffix<word, prev>,
                          ...Words<rest, `${prev}${curr}`, curr>,
                        ]
                      : Reject<Words<rest, `${word}${curr}`, curr>, ''> // Otherwise continue with the sentence
    : // Step 8: Trim the last word
      Reject<[word], ''>
  : string[]
```
