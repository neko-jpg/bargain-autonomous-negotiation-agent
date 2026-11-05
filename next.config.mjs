/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * Next 16 blocks `_next/*` dev asset requests whose Origin is not localhost.
   * Without this, opening the dev server on 127.0.0.1 (or a LAN/preview host)
   * returns 403 for the client chunks, so the page never hydrates and stays on
   * the server-rendered loading screen. Add any other dev host you use here
   * (hostname only, no scheme or port). Production is unaffected.
   */
  allowedDevOrigins: ['127.0.0.1'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ];
  },
  // pg loads pg-cloudflare through a conditional/dynamic require. Explicitly
  // include the Worker socket implementation in Next's traced server files so
  // OpenNext can resolve it during the Cloudflare bundle step.
  outputFileTracingIncludes: {
    '/*': ['./node_modules/pg-cloudflare/dist/**/*', './node_modules/pg-cloudflare/esm/**/*'],
  },
  images: {
    localPatterns: [
      {
        pathname: '/images/products/pexels-selected/**',
      },
    ],
  },
};

export default nextConfig;
