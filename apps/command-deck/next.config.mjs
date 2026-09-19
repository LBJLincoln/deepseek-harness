/**
 * Next.js configuration for the Command Deck.
 *
 * `transpilePackages` covers the three.js ecosystem: `three/examples/jsm` and
 * the drei/postprocessing helpers ship untranspiled ESM that Next's server
 * bundler must compile rather than treat as external.
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['three', '@react-three/drei', '@react-three/fiber', '@react-three/postprocessing'],
  eslint: { ignoreDuringBuilds: true },
}

export default nextConfig
