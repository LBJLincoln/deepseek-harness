/**
 * Inline Markdown rendered to HTML: backslash escapes, code spans, autolinks,
 * inline links and emphasis.
 *
 * The renderer walks the text once. At each position it tries, in order, a
 * backslash escape, a code span, an autolink, an inline link and an emphasis
 * run; anything that does not start one of those is ordinary text.
 */

const ASCII_PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/;
const WHITESPACE = /\s/;
const ALPHANUMERIC = /[A-Za-z0-9]/;
const HEX_PAIR = /^[0-9A-Fa-f]{2}$/;
const AUTOLINK_URI = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/y;
const AUTOLINK_EMAIL =
  /<([A-Za-z0-9.!#$%&'*/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/y;

/**
 * Escape the characters that cannot appear raw in HTML text or attributes.
 *
 * @param {string} text text to escape
 * @returns {string} the escaped text
 */
export function escapeHtml(text) {
  let out = '';
  for (const character of text) {
    if (character === '&') out += '&amp;';
    else if (character === '<') out += '&lt;';
    else if (character === '>') out += '&gt;';
    else if (character === '"') out += '&quot;';
    else out += character;
  }
  return out;
}

/**
 * Prepare a link destination for an `href` attribute.
 *
 * Existing percent-triplets are left alone; the characters that would end the
 * attribute or the URL are percent-encoded.
 *
 * @param {string} destination raw destination text
 * @returns {string} the attribute value
 */
function encodeDestination(destination) {
  let out = '';
  let i = 0;
  while (i < destination.length) {
    const character = destination[i];
    if (character === '%' && HEX_PAIR.test(destination.slice(i + 1, i + 3))) {
      out += `%25${destination.slice(i + 1, i + 3)}`;
      i += 3;
      continue;
    }
    if (character === ' ') out += '%20';
    else if (character === '"') out += '%22';
    else if (character === '<') out += '%3C';
    else if (character === '>') out += '%3E';
    else if (character === '\\') out += '%5C';
    else if (character === '`') out += '%60';
    else out += character;
    i += 1;
  }
  return escapeHtml(out);
}

/**
 * Resolve backslash escapes inside a destination or a title.
 *
 * @param {string} text raw text
 * @returns {string} the text with escaped punctuation unescaped
 */
function unescape(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\\' && text[i + 1] !== undefined && ASCII_PUNCTUATION.test(text[i + 1])) {
      out += text[i + 1];
      i += 2;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out;
}

/**
 * Measure the run of one character starting at a position.
 *
 * @param {string} text source text
 * @param {number} start index of the first character of the run
 * @returns {number} how many times the character repeats
 */
function runLength(text, start) {
  const character = text[start];
  let length = 0;
  while (text[start + length] === character) length += 1;
  return length;
}

/**
 * Read a code span opened at `start`.
 *
 * @param {string} text source text
 * @param {number} start index of the first backtick
 * @returns {{ html: string, end: number } | null} the rendered span, or null when the run never closes
 */
function codeSpan(text, start) {
  const length = runLength(text, start);
  let i = start + length;
  while (i < text.length) {
    if (text[i] !== '`') {
      i += 1;
      continue;
    }
    const closing = runLength(text, i);
    if (closing >= 1) {
      let content = text.slice(start + length, i);
      if (content.trim() !== '') {
        content = content.trim();
      }
      return { html: `<code>${escapeHtml(content)}</code>`, end: i + closing };
    }
    i += closing;
  }
  return null;
}

/**
 * Read an autolink opened at `start`.
 *
 * @param {string} text source text
 * @param {number} start index of the `<`
 * @returns {{ html: string, end: number } | null} the rendered link, or null when this is not an autolink
 */
function autolink(text, start) {
  AUTOLINK_URI.lastIndex = start;
  const uri = AUTOLINK_URI.exec(text);
  if (uri !== null) {
    return { html: `<a href="${encodeDestination(uri[1])}">${escapeHtml(uri[1])}</a>`, end: start + uri[0].length };
  }
  AUTOLINK_EMAIL.lastIndex = start;
  const email = AUTOLINK_EMAIL.exec(text);
  if (email !== null) {
    return {
      html: `<a href="mailto:${encodeDestination(email[1])}">${escapeHtml(email[1])}</a>`,
      end: start + email[0].length,
    };
  }
  return null;
}

/**
 * Find the `]` that closes the bracket at `start`.
 *
 * @param {string} text source text
 * @param {number} start index of the `[`
 * @returns {number} index of the closing bracket, or -1 when there is none
 */
function matchBracket(text, start) {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const character = text[i];
    if (character === '\\') {
      i += 2;
      continue;
    }
    if (character === '[') depth += 1;
    else if (character === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

/**
 * Read the destination and optional title of an inline link.
 *
 * @param {string} text source text
 * @param {number} start index just past the `(`
 * @returns {{ destination: string, title: string | null, end: number } | null} the parts, or null when malformed
 */
function linkTarget(text, start) {
  let i = start;
  while (i < text.length && WHITESPACE.test(text[i])) i += 1;

  let destination = '';
  if (text[i] === '<') {
    i += 1;
    let raw = '';
    while (i < text.length && text[i] !== '>') {
      if (text[i] === '<') return null;
      if (text[i] === '\\') {
        raw += text.slice(i, i + 2);
        i += 2;
        continue;
      }
      raw += text[i];
      i += 1;
    }
    if (text[i] !== '>') return null;
    i += 1;
    destination = unescape(raw);
  } else {
    let depth = 0;
    let raw = '';
    while (i < text.length) {
      const character = text[i];
      if (WHITESPACE.test(character)) break;
      if (character === '\\') {
        raw += text.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (character === '(') depth += 1;
      if (character === ')') {
        if (depth === 0) break;
        depth -= 1;
      }
      raw += character;
      i += 1;
    }
    if (depth !== 0) return null;
    destination = unescape(raw);
  }

  while (i < text.length && WHITESPACE.test(text[i])) i += 1;

  let title = null;
  if (text[i] === '"' || text[i] === "'") {
    const quote = text[i];
    i += 1;
    let raw = '';
    while (i < text.length && text[i] !== quote) {
      if (text[i] === '\\') {
        raw += text.slice(i, i + 2);
        i += 2;
        continue;
      }
      raw += text[i];
      i += 1;
    }
    if (text[i] !== quote) return null;
    i += 1;
    title = unescape(raw);
    while (i < text.length && WHITESPACE.test(text[i])) i += 1;
  }

  if (text[i] !== ')') return null;
  return { destination, title, end: i + 1 };
}

/**
 * Read an inline link opened at `start`.
 *
 * @param {string} text source text
 * @param {number} start index of the `[`
 * @returns {{ html: string, end: number } | null} the rendered link, or null when this is not a link
 */
function inlineLink(text, start) {
  const close = matchBracket(text, start);
  if (close === -1 || text[close + 1] !== '(') return null;
  const target = linkTarget(text, close + 2);
  if (target === null) return null;
  const label = render(text.slice(start + 1, close), false);
  const title = target.title === null ? '' : ` title="${escapeHtml(target.title)}"`;
  return { html: `<a href="${encodeDestination(target.destination)}"${title}>${label}</a>`, end: target.end };
}

/**
 * Whether a delimiter run may open emphasis.
 *
 * @param {string} text source text
 * @param {number} start index of the run
 * @param {number} length length of the run
 * @param {string} marker `*` or `_`
 * @returns {boolean} true when the run can open
 */
function canOpen(text, start, length, marker) {
  const after = text[start + length];
  if (after === undefined || WHITESPACE.test(after)) return false;
  if (marker === '*') {
    const before = text[start - 1];
    if (before !== undefined && ALPHANUMERIC.test(before)) return false;
  }
  return true;
}

/**
 * Whether a delimiter run may close emphasis.
 *
 * @param {string} text source text
 * @param {number} start index of the run
 * @param {number} length length of the run
 * @param {string} marker `*` or `_`
 * @returns {boolean} true when the run can close
 */
function canClose(text, start, length, marker) {
  const before = text[start - 1];
  if (before === undefined || WHITESPACE.test(before)) return false;
  if (marker === '*') {
    const after = text[start + length];
    if (after !== undefined && ALPHANUMERIC.test(after)) return false;
  }
  return true;
}

/**
 * Read an emphasis run opened at `start`.
 *
 * @param {string} text source text
 * @param {number} start index of the first delimiter
 * @param {boolean} allowLinks whether links may be recognised inside
 * @returns {{ html: string, end: number } | null} the rendered emphasis, or null when the run does not open one
 */
/**
 * Find the first run that may close emphasis and is long enough.
 *
 * @param {string} text source text
 * @param {number} from index to start searching at
 * @param {string} marker `*` or `_`
 * @param {number} minimum shortest run that may close
 * @returns {{ start: number, length: number } | null} the closing run, or null when there is none
 */
function findCloser(text, from, marker, minimum) {
  let i = from;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] !== marker) {
      i += 1;
      continue;
    }
    const length = runLength(text, i);
    if (length >= minimum && canClose(text, i, length, marker)) return { start: i, length };
    i += length;
  }
  return null;
}

/**
 * Read an emphasis run opened at `start`.
 *
 * @param {string} text source text
 * @param {number} start index of the first delimiter
 * @param {boolean} allowLinks whether links may be recognised inside
 * @returns {{ html: string, end: number } | null} the rendered emphasis, or null when the run does not open one
 */
function emphasis(text, start, allowLinks) {
  const marker = text[start];
  const length = runLength(text, start);
  if (!canOpen(text, start, length, marker)) return null;

  for (let use = Math.min(length, 2); use >= 1; use -= 1) {
    const closer = findCloser(text, start + length, marker, use);
    if (closer === null) continue;
    const inner = render(text.slice(start + use, closer.start + closer.length - use), allowLinks);
    const tag = use === 2 ? 'strong' : 'em';
    return { html: `<${tag}>${inner}</${tag}>`, end: closer.start + closer.length };
  }
  return null;
}

/**
 * Render one stretch of inline Markdown.
 *
 * @param {string} text source text
 * @param {boolean} allowLinks whether links may be recognised, false inside a link's own text
 * @returns {string} the rendered HTML
 */
function render(text, allowLinks) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const character = text[i];

    if (character === '\\') {
      const next = text[i + 1];
      if (next !== undefined && ASCII_PUNCTUATION.test(next)) {
        out += escapeHtml(next);
        i += 2;
        continue;
      }
      out += '\\';
      i += 1;
      continue;
    }

    if (character === '`') {
      const span = codeSpan(text, i);
      if (span !== null) {
        out += span.html;
        i = span.end;
        continue;
      }
      const length = runLength(text, i);
      out += '`'.repeat(length);
      i += length;
      continue;
    }

    if (character === '<') {
      const link = autolink(text, i);
      if (link !== null) {
        out += link.html;
        i = link.end;
        continue;
      }
    }

    if (character === '[' && allowLinks) {
      const link = inlineLink(text, i);
      if (link !== null) {
        out += link.html;
        i = link.end;
        continue;
      }
    }

    if (character === '*' || character === '_') {
      const span = emphasis(text, i, allowLinks);
      if (span !== null) {
        out += span.html;
        i = span.end;
        continue;
      }
      const length = runLength(text, i);
      out += character.repeat(length);
      i += length;
      continue;
    }

    out += escapeHtml(character);
    i += 1;
  }
  return out;
}

/**
 * Render inline Markdown to HTML.
 *
 * @param {string} markdown source text, one paragraph's worth of inline content
 * @returns {string} the rendered HTML
 */
export function renderInline(markdown) {
  if (typeof markdown !== 'string') throw new TypeError('markdown must be a string');
  return render(markdown, true);
}
