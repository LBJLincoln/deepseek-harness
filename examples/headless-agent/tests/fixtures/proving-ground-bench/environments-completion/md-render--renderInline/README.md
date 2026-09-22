# mdlite

A small Markdown-to-HTML converter with no dependencies. It reads a document from standard input and writes HTML, or the document's outline, to standard output.

## Layout

| File | What it owns |
| --- | --- |
| `src/cli.js` | the argument forms, the mode dispatch, and how a failure is reported |
| `src/block.js` | the block grammar — fences, headings, lists, paragraphs — and the rendering of each |
| `src/inline.js` | the inline grammar: escapes, code spans, emphasis, and links |
| `src/html.js` | `escapeText` and `escapeAttribute` |

`test/mdlite.test.js` is the suite for what is already here, and `data/` holds the link-definition files the examples name.

## Blocks

The document is split on newlines and the empty tail a trailing newline leaves is dropped. A line is then read as one of these, in this order.

A line of three or more backticks with no further backtick on it opens a fenced code block, and its info string is the rest of the line, trimmed, of which the first word is used. The fence closes at the first later line that is nothing but backticks, at least as many as the opening had, and everything between the two is content. A fence that never closes fails. A blank line ends whatever block was open. `#` to `######` followed by a space is a heading of that level, over the trimmed rest of the line. `- ` at the very start of a line is a bullet item, unless a paragraph is already open, in which case it is one of that paragraph's lines. Anything else is a paragraph line, trimmed.

Each block renders to `<h1>` to `<h6>`, `<p>` with its lines joined by newlines, `<ul>` with one `<li>` per item on its own line, or `<pre><code>` with the content copied in, `class="language-<info>"` when there is an info string. The blocks are joined with newlines and the output ends with one; an empty document renders nothing at all.

## Inline

A backslash before one of `` \ ` * [ ] ( ) `` writes that character literally. A backtick pair is a code span, with its content escaped. `**` pairs make `<strong>` and `*` pairs make `<em>`, each rendering its content inline. `[text](url)` is a link, with the text rendered inline and the url escaped for the attribute. An unmatched marker is literal text. Everything else is escaped for HTML.

## Modes

- `html` writes the rendered document.
- `outline` writes one line per heading, `<level> <raw heading text>`.

## Failures

Every refusal writes one line to standard error and exits 2, having written nothing to standard output; the first failure stops the run. An unterminated fence is `error: line N: unterminated code fence`, naming the line the fence opened on. A malformed argument list is refused with the usage line.

## Known gaps

A list is flat: an indented `- ` is a paragraph line, not a nested item. There are no reference links, so `[text][label]` is literal text and a `[label]: url` line renders as a paragraph. Fence content is copied out verbatim, so a `<` in a code block escapes into the surrounding HTML and a document that shows HTML in a code block renders wrong.
