# csv-tools

`csv-tools` is a command line over comma-separated files, written for Node.js with no dependency outside `node:` built-ins. This file is the whole specification: the departments of the program build against it, and `test/` is the committed suite that decides whether they did.

Three subcommands: `stats` reports per-column count, minimum, maximum and mean over numeric columns; `filter` prints the rows whose named column matches an operator and a value; `join` inner-joins two files on a named column.

## Layout

| Path | Owner |
| --- | --- |
| `bin/csv-tools.js` | committed at the base revision; nothing changes it |
| `test/*.test.js` | committed at the base revision; nothing changes it |
| `src/csv.js` | the `stats` department: the shared reader and writer |
| `src/stats.js` | the `stats` department |
| `src/filter.js` | the `filter` department |
| `src/join.js` | the `join` department |

Every department branch is cut from the same base revision, so a department sees no file another department writes. `src/filter.js` and `src/join.js` therefore import nothing at all, and only `bin/csv-tools.js` — which the merged head carries — composes the reader with a subcommand. `src/stats.js` may import `src/csv.js`, because the same department owns both.

Install nothing. A `node_modules` directory in the worktree fails the department's own check.

## The CSV dialect

An RFC 4180 subset, with a comma delimiter and `"` as the quote character.

- Records are terminated by CRLF, LF or a lone CR. One terminator at the very end of the document closes the last record without starting an empty one, so `a\n` and `a` are both one record while `a\n\n` is two and `\n` is one record holding one empty field. A document with no characters has no records.
- A field is quoted only when `"` is its very first character. Inside the quotes a doubled `""` stands for one literal quote, and commas and terminators are data. After the closing quote only a comma, a terminator or the end of the document may follow; anything else is `unexpected character after closing quote: <character>`. A `"` anywhere else in a field is ordinary text.
- A quoted field the document never closes is `unterminated quoted field`.
- Fields are never trimmed, and an empty field is preserved wherever it appears.
- The first record is the header. Its names are used verbatim; a repeated name is `duplicate column: <name>`. A document with no records at all is `input has no header record`.
- Every data row carries exactly as many fields as the header; otherwise `row <n>: expected <h> fields, got <g>`, where `n` counts data rows from 1.

Output is written in the same dialect with LF terminators, one after every record including the last. A field is quoted, with every embedded `"` doubled, exactly when it contains a comma, a `"`, a CR or an LF.

## Module contracts

A table is `{ header: string[], rows: string[][] }`.

- `src/csv.js` exports `parseCsv(text) -> table`, `formatCsv(table) -> string` and `escapeField(value) -> string`.
- `src/stats.js` exports `stats(table) -> table`.
- `src/filter.js` exports `filter(table, column, operator, value) -> table`.
- `src/join.js` exports `join(left, right, column) -> table`.

Every failure is an `Error` whose `code` property is `'usage'` when the command line itself is wrong and `'data'` when the input is. The message is the diagnostic, without a prefix and without a trailing newline.

## What is a number

One rule, used by `stats` for recognising a numeric column and by `filter` for `<` and `>`: a value is a number when it matches `-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?` from end to end. A leading `+`, a leading zero (`007`), a bare `.5`, `NaN` and `Infinity` are not numbers, so a column of zero-padded identifiers is text.

A printed number is `String(Math.round(value * 1e6) / 1e6)`, so a result is rounded to six decimal places and an integer keeps its plain form.

## `stats`

`csv-tools stats <file>` prints the header `column,count,min,max,mean` and then one record per numeric column, in header order.

A column is numeric when it has at least one non-empty value and every non-empty value in it is a number. Empty values are skipped rather than counted, so `count` is the number of non-empty values and a column of only empty values is not numeric. A file whose columns are all text prints the header record alone.

## `filter`

`csv-tools filter <file> <column> <operator> <value>` prints the header record and then every row whose `<column>` cell matches.

The operators are `=`, `!=`, `<`, `>` and `contains`. `=` and `!=` compare the cell and the value as strings. `contains` is a case-sensitive substring test. `<` and `>` compare numerically when the cell and the value are both numbers and otherwise compare the two strings by UTF-16 code unit. An operator outside the five is the usage error `unknown operator: <operator>`; a column outside the header is the data error `unknown column: <column>`. A filter nothing matches prints the header record alone and succeeds.

## `join`

`csv-tools join <left> <right> <column>` prints the inner join of the two files on `<column>`.

The output header is the left header followed by every right column except the join column. One output row is emitted for each pair of a left row and a right row whose `<column>` cells are equal as strings, left rows in file order outermost and right rows in file order innermost, so a key repeated on both sides yields every pair.

`<column>` missing from either header is the data error `unknown column: <column>`. A right column carried into the output whose name is already in the left header is the data error `duplicate column: <name>`.

## Exit codes and channels

| Code | Meaning |
| --- | --- |
| `0` | the subcommand succeeded |
| `1` | the command line is wrong: no subcommand, an unknown subcommand, the wrong number of arguments, an unknown operator |
| `2` | the input is wrong: a file that cannot be read, a malformed document, an unknown or duplicate column |

A successful run writes the result to stdout and nothing at all to stderr. A failing run writes nothing to stdout and exactly one line to stderr, `csv-tools: <message>`, terminated by LF.

The argument counts are `stats` 1, `filter` 4 and `join` 3. A wrong count is `<subcommand> takes <n> argument(s), got <m>`, and a missing or unknown subcommand is `expected one of stats, filter, join, got <word>` — `nothing` when the command line is empty.
