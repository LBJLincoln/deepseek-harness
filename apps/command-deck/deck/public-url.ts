/**
 * URLs of the files under `public/`.
 *
 * The deck is served under `NEXT_PUBLIC_BASE_PATH` when the build sets it, as
 * the GitHub Pages export does because a repository site lives at
 * `/<repository>`; Next rewrites its own routes and chunks under that prefix,
 * but a plain `src` or `href` to a public file must carry it itself.
 */

/** The path prefix the deck is served under, empty when the build set none. */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

/**
 * The URL one public file is served at.
 * @param path - The file's path under `public/`, without a leading slash, such as `posters/enterprise.jpg`.
 * @returns The path under the deck's base path.
 */
export function publicUrl(path: string): string {
  return `${BASE_PATH}/${path}`
}
