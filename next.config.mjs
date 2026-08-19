/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
