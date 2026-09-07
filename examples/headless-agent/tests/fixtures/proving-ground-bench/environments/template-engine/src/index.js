/**
 * A mini template engine: interpolation with HTML escaping, dotted paths,
 * sections and inverted sections over a context stack, and partials.
 */

/** Error raised for malformed templates and impossible renders. */
export class TemplateError extends Error {
  /**
   * @param {string} code Stable machine-readable reason.
   * @param {string} message Human-readable detail.
   * @param {number} index Zero-based offset of the offending tag.
   */
  constructor(code, message, index) {
    super(message);
    this.name = 'TemplateError';
    this.code = code;
    this.index = index;
  }
}

const ESCAPES = [
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
  ['&', '&amp;'],
];

const NAME_PATTERN = /^(\.|[A-Za-z0-9_$]+(\.[A-Za-z0-9_$]+)*)$/;
const DEFAULT_MAX_DEPTH = 16;

/**
 * Escape the five characters that are unsafe in HTML text and attributes.
 *
 * @param {string} text Text to escape.
 * @returns {string} Escaped text.
 */
export function escapeHtml(text) {
  if (typeof text !== 'string') throw new TemplateError('BAD_INPUT', 'text must be a string', 0);
  let result = text;
  for (const [from, to] of ESCAPES) result = result.split(from).join(to);
  return result;
}

/**
 * Classify the sigil at the front of a tag.
 *
 * @param {string} body Raw tag body without the braces.
 * @returns {{sigil: string, name: string}} Sigil (empty for a plain variable) and trimmed name.
 */
function splitTag(body) {
  const trimmed = body.trim();
  if (trimmed === '') return { sigil: '', name: '' };
  if ('#^/>&!'.includes(trimmed[0])) {
    return { sigil: trimmed[0], name: trimmed.slice(1).trim() };
  }
  return { sigil: '', name: trimmed };
}

/**
 * Parse a template into nodes.
 *
 * @param {string} template Template source.
 * @returns {object[]} Node list.
 */
export function parse(template) {
  if (typeof template !== 'string') throw new TemplateError('BAD_TEMPLATE', 'template must be a string', 0);
  const root = [];
  const open = [{ name: null, children: root, index: 0 }];
  const current = () => open[open.length - 1];
  let index = 0;
  let text = '';

  const flushText = () => {
    if (text === '') return;
    current().children.push({ type: 'text', value: text });
    text = '';
  };

  while (index < template.length) {
    const start = template.indexOf('{{', index);
    if (start === -1) {
      text += template.slice(index);
      index = template.length;
      break;
    }
    text += template.slice(index, start);
    const triple = template.startsWith('{{{', start);
    const opener = triple ? 3 : 2;
    const closer = triple ? '}}}' : '}}';
    const stop = template.indexOf(closer, start + opener);
    if (stop === -1) throw new TemplateError('UNCLOSED_TAG', 'unclosed tag', start);
    const { sigil, name } = splitTag(template.slice(start + opener, stop));
    index = stop + closer.length;

    if (sigil === '!') continue;
    if (name === '') throw new TemplateError('EMPTY_NAME', 'a tag needs a name', start);
    if (!NAME_PATTERN.test(name)) throw new TemplateError('BAD_NAME', `invalid name: ${name}`, start);

    if (sigil === '#' || sigil === '^') {
      flushText();
      const section = { type: 'section', name, inverted: sigil === '^', children: [] };
      current().children.push(section);
      open.push({ name, children: section.children, index: start });
      continue;
    }
    if (sigil === '/') {
      if (open.length === 1 || current().name !== name) {
        throw new TemplateError('MISMATCHED_SECTION', `unexpected closing tag: ${name}`, start);
      }
      flushText();
      open.pop();
      continue;
    }
    flushText();
    if (sigil === '>') current().children.push({ type: 'partial', name });
    else current().children.push({ type: 'variable', name, escaped: !triple && sigil !== '&' });
  }

  if (open.length > 1) {
    throw new TemplateError('UNCLOSED_SECTION', `unclosed section: ${current().name}`, current().index);
  }
  flushText();
  return root;
}

/**
 * Report whether a value makes a section render nothing.
 *
 * @param {unknown} value Resolved section value.
 * @returns {boolean} True when the section is empty.
 */
function isEmpty(value) {
  if (Array.isArray(value)) return value.length === 0;
  return !value;
}

/**
 * Render a resolved value as text.
 *
 * @param {unknown} value Resolved value.
 * @returns {string} Text, empty for null and undefined.
 */
function stringify(value) {
  if (value === null || value === undefined) return '';
  return String(value || '');
}

/**
 * Report whether a frame carries a property.
 *
 * @param {unknown} frame Context frame.
 * @param {string} key Property name.
 * @returns {boolean} True when the frame owns the property.
 */
function owns(frame, key) {
  return frame !== null && typeof frame === 'object' && Object.prototype.hasOwnProperty.call(frame, key);
}

/**
 * Resolve a name against the context stack, innermost frame first.
 *
 * @param {unknown[]} stack Context frames, innermost first.
 * @param {string} path Dotted path or `.` for the current context.
 * @returns {unknown} The resolved value, or undefined.
 */
function resolve(stack, path) {
  if (path === '.') return stack[0];
  const parts = path.split('.');
  for (const frame of [...stack].reverse()) {
    if (!owns(frame, parts[0])) continue;
    let value = frame[parts[0]];
    for (const part of parts.slice(1)) {
      if (!owns(value, part)) return undefined;
      value = value[part];
    }
    return value;
  }
  return undefined;
}

/**
 * Render a node list against a context stack.
 *
 * @param {object[]} nodes Nodes to render.
 * @param {unknown[]} stack Context frames, innermost first.
 * @param {{partials: Record<string, string>, maxDepth: number, depth: number}} state Shared render state.
 * @returns {string} Rendered text.
 */
function renderNodes(nodes, stack, state) {
  let output = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      output += node.value;
      continue;
    }
    if (node.type === 'variable') {
      const text = stringify(resolve(stack, node.name));
      output += node.escaped ? escapeHtml(text) : text;
      continue;
    }
    if (node.type === 'section') {
      const value = resolve(stack, node.name);
      if (node.inverted) {
        if (!value) output += renderNodes(node.children, stack, state);
        continue;
      }
      if (isEmpty(value)) continue;
      if (Array.isArray(value)) {
        for (const item of value) output += renderNodes(node.children, [item, ...stack], state);
      } else if (typeof value === 'object') {
        output += renderNodes(node.children, [value, ...stack], state);
      } else {
        output += renderNodes(node.children, stack, state);
      }
      continue;
    }
    const source = state.partials[node.name];
    if (typeof source !== 'string') {
      throw new TemplateError('UNKNOWN_PARTIAL', `unknown partial: ${node.name}`, 0);
    }
    if (state.depth >= state.maxDepth) {
      throw new TemplateError('PARTIAL_DEPTH', `partials nested deeper than ${state.maxDepth}`, 0);
    }
    state.depth += 1;
    output += renderNodes(parse(source), stack, state);
  }
  return output;
}

/**
 * Validate render options into the state one render pass shares.
 *
 * @param {{partials?: Record<string, string>, maxDepth?: number}} options Caller options.
 * @returns {{partials: Record<string, string>, maxDepth: number, depth: number}} Fresh render state.
 */
function checkOptions(options) {
  if (typeof options !== 'object' || options === null) {
    throw new TemplateError('BAD_INPUT', 'options must be an object', 0);
  }
  const partials = options.partials ?? {};
  if (typeof partials !== 'object' || partials === null) {
    throw new TemplateError('BAD_INPUT', 'partials must be an object', 0);
  }
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    throw new TemplateError('BAD_INPUT', 'maxDepth must be a positive integer', 0);
  }
  return { partials, maxDepth, depth: 0 };
}

/**
 * Parse a template once and render it as often as you like.
 *
 * @param {string} template Template source.
 * @returns {(data?: unknown, options?: object) => string} Renderer over the parsed template.
 */
export function compile(template) {
  const nodes = parse(template);
  return (data = {}, options = {}) => renderNodes(nodes, [data], checkOptions(options));
}

/**
 * Render a template.
 *
 * @param {string} template Template source.
 * @param {unknown} [data] Root context.
 * @param {{partials?: Record<string, string>, maxDepth?: number}} [options] Partials and recursion limit.
 * @returns {string} Rendered text.
 */
export function render(template, data = {}, options = {}) {
  return compile(template)(data, options);
}
