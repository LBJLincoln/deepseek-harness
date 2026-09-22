/** RFC 3986 reference parsing, syntax-based normalization, and reference resolution. */

/** Appendix B: the five components of a URI reference, any of which may be absent. */
const URI_REFERENCE = /^(?:([^:/?#]+):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/u

/** Characters that never need percent-encoding, so an encoded one is decoded. */
const UNRESERVED = /^[A-Za-z0-9\-._~]$/u

/** Ports a scheme implies, which normalization drops when they are written out. */
const DEFAULT_PORT = { http: '80', https: '443', ws: '80', wss: '443', ftp: '21' }

/** A percent-encoding triplet with two hexadecimal digits. */
const TRIPLET = /%[0-9A-Fa-f]{2}/u

/** Raised for input the syntax rejects; the message is what the program reports. */
export class UriError extends Error {
  /**
   * @param message - the reported reason, without a position.
   */
  constructor(message) {
    super(message)
    this.name = 'UriError'
  }
}

/** ASCII-only lowercasing, so a Turkish or Greek locale cannot change a scheme or host. */
function lowerAscii(text) {
  let out = ''
  for (const character of text) {
    const code = character.codePointAt(0)
    out += code >= 0x41 && code <= 0x5A ? String.fromCharCode(code + 0x20) : character
  }
  return out
}

/**
 * Normalize percent-encodings in one component: uppercase every triplet's hex
 * digits, then decode the triplets that stand for an unreserved character.
 * @param text - the raw component.
 * @param subject - what the component is, for the error message.
 * @returns the component with its percent-encodings normalized.
 * @throws {UriError} when a `%` is not followed by two hexadecimal digits.
 */
export function normalizePercent(text, subject) {
  let out = ''
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '%') {
      out += text[index]
      continue
    }
    const triplet = text.slice(index, index + 3)
    if (!TRIPLET.test(triplet)) throw new UriError(`${subject} has a truncated percent-encoding`)
    const octet = Number.parseInt(triplet.slice(1), 16)
    const decoded = String.fromCharCode(octet)
    out += UNRESERVED.test(decoded) ? decoded : `%${triplet.slice(1).toUpperCase()}`
    index += 2
  }
  return out
}

/**
 * Split an authority into its userinfo, host, and port. The host runs from
 * after the last `@` to the `:` that starts the port, and a `:` inside an IPv6
 * literal's brackets is part of the host.
 * @param authority - the authority, without its leading `//`.
 * @returns the three parts, with `userinfo` and `port` absent when unwritten.
 */
export function splitAuthority(authority) {
  const at = authority.lastIndexOf('@')
  const userinfo = at === -1 ? undefined : authority.slice(0, at)
  const rest = authority.slice(at + 1)
  const bracket = rest.lastIndexOf(']')
  const colon = rest.indexOf(':', bracket === -1 ? 0 : bracket)
  if (colon === -1) return { userinfo, host: rest, port: undefined }
  return { userinfo, host: rest.slice(0, colon), port: rest.slice(colon + 1) }
}

/**
 * Parse a URI reference into its five components. Every group of the generic
 * syntax is optional and the last is unbounded, so any line matches and the
 * parse itself never fails; a malformed reference is caught by normalization.
 * @param text - the reference, which holds no newline.
 * @returns the components; `scheme`, `authority`, `query`, and `fragment` are absent when unwritten, and `path` is always a string.
 */
export function parse(text) {
  const match = URI_REFERENCE.exec(text)
  return { scheme: match[1], authority: match[2], path: match[3] ?? '', query: match[4], fragment: match[5] }
}

/**
 * RFC 3986 section 5.2.4: interpret `.` and `..` segments against the path,
 * discarding a `..` that would climb above the root.
 * @param path - the path to resolve.
 * @returns the path with no dot segments left.
 */
export function removeDotSegments(path) {
  const out = []
  let rest = path
  while (rest !== '') {
    if (rest.startsWith('../')) rest = rest.slice(3)
    else if (rest.startsWith('./')) rest = rest.slice(2)
    else if (rest.startsWith('/./')) rest = `/${rest.slice(3)}`
    else if (rest === '/.') rest = '/'
    else if (rest.startsWith('/../')) {
      rest = `/${rest.slice(4)}`
      out.pop()
    } else if (rest === '/..') {
      rest = '/'
      out.pop()
    } else if (rest === '.' || rest === '..') rest = ''
    else {
      const next = rest.indexOf('/', rest.startsWith('/') ? 1 : 0)
      const segment = next === -1 ? rest : rest.slice(0, next)
      out.push(segment)
      rest = next === -1 ? '' : rest.slice(next)
    }
  }
  return out.join('')
}

/** Rebuild a reference from its components, keeping an empty query or fragment visible. */
function recompose(parts) {
  let out = parts.scheme === undefined ? '' : `${parts.scheme}:`
  if (parts.authority !== undefined) out += `//${parts.authority}`
  out += parts.path
  if (parts.query !== undefined) out += `?${parts.query}`
  if (parts.fragment !== undefined) out += `#${parts.fragment}`
  return out
}

/** Reassemble an authority from the parts `splitAuthority` produced. */
function joinAuthority(userinfo, host, port) {
  return `${userinfo === undefined ? '' : `${userinfo}@`}${host}${port === undefined ? '' : `:${port}`}`
}

/**
 * Syntax-based normalization of parsed components: case, percent-encodings,
 * the default port, dot segments, and the empty path under an authority.
 * @param parts - the parsed components.
 * @returns the normalized components.
 * @throws {UriError} when a component carries a truncated percent-encoding.
 */
export function normalizeParts(parts) {
  const scheme = parts.scheme === undefined ? undefined : lowerAscii(parts.scheme)
  let authority
  if (parts.authority !== undefined) {
    const { userinfo, host, port } = splitAuthority(parts.authority)
    const normalizedPort = port === undefined || port === '' || port === DEFAULT_PORT[scheme] ? undefined : port
    authority = joinAuthority(
      userinfo === undefined ? undefined : normalizePercent(userinfo, 'the userinfo'),
      lowerAscii(normalizePercent(host, 'the host')),
      normalizedPort,
    )
  }
  let path = removeDotSegments(normalizePercent(parts.path, 'the path'))
  if (authority !== undefined && path === '') path = '/'
  return {
    scheme,
    authority,
    path,
    query: parts.query === undefined ? undefined : normalizePercent(parts.query, 'the query'),
    fragment: parts.fragment === undefined ? undefined : normalizePercent(parts.fragment, 'the fragment'),
  }
}

/**
 * Normalize one URI reference.
 * @param text - the reference.
 * @returns the normalized reference.
 * @throws {UriError} when the reference is not well formed.
 */
export function normalize(text) {
  return recompose(normalizeParts(parse(text)))
}

/** RFC 3986 section 5.2.3: graft a relative path onto the base's. */
function merge(base, path) {
  if (base.authority !== undefined && base.path === '') return `/${path}`
  const cut = base.path.lastIndexOf('/')
  return cut === -1 ? path : `${base.path.slice(0, cut + 1)}${path}`
}

/**
 * RFC 3986 section 5.2.2 in its strict form — a reference that repeats the
 * base's scheme is still absolute — followed by normalization of the target.
 * @param baseText - the base URI, which must carry a scheme.
 * @param referenceText - the reference resolved against it.
 * @returns the normalized target URI.
 * @throws {UriError} when either side is malformed or the base has no scheme.
 */
export function resolve(baseText, referenceText) {
  const base = parse(baseText)
  if (base.scheme === undefined) throw new UriError('the base has no scheme')
  const reference = parse(referenceText)
  let target
  if (reference.scheme !== undefined) {
    target = { ...reference, path: removeDotSegments(reference.path) }
  } else if (reference.authority !== undefined) {
    target = { scheme: base.scheme, authority: reference.authority, path: removeDotSegments(reference.path), query: reference.query, fragment: reference.fragment }
  } else if (reference.path === '') {
    target = {
      scheme: base.scheme,
      authority: base.authority,
      path: base.path,
      query: reference.query === undefined ? base.query : reference.query,
      fragment: reference.fragment,
    }
  } else {
    const path = reference.path.startsWith('/') ? reference.path : merge(base, reference.path)
    target = { scheme: base.scheme, authority: base.authority, path: removeDotSegments(path), query: reference.query, fragment: reference.fragment }
  }
  return recompose(normalizeParts(target))
}
