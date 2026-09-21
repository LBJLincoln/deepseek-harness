/**
 * Next.js configuration for the Command Deck.
 *
 * `transpilePackages` covers the three.js ecosystem: `three/examples/jsm` and
 * the drei/postprocessing helpers ship untranspiled ESM that Next's server
 * bundler must compile rather than treat as external.
 *
 * `NEXT_PUBLIC_BASE_PATH` is the path prefix the deck is served under; GitHub
 * Pages serves a repository site at `/<repository>`. The feed client reads the
 * same variable, so replay finds `public/fixtures` under the prefix. With
 * `DECK_STATIC=1` the build is the static export under `out/`: every view is a
 * Client Component over static fixtures, so the export is the whole deck in
 * replay mode; without it the build is the server `next start` serves.
 *
 * `trailingSlash` keeps client navigation working on a static host under a
 * prefix: the router fetches a route's payload from `<href>index.txt` when the
 * href ends in a slash and from `<href>.txt` otherwise, and `<prefix>.txt` is
 * a file no project site can serve, so without it every navigation to `/`
 * became a full page load that also lost the cold open.
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['three', '@react-three/drei', '@react-three/fiber', '@react-three/postprocessing'],
  eslint: { ignoreDuringBuilds: true },
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '',
  trailingSlash: true,
  ...(process.env.DECK_STATIC === '1' ? { output: 'export' } : {}),
}

export default nextConfig
