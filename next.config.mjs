/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    localPatterns: [
      {
        pathname: '/images/products/pexels-selected/**',
      },
    ],
  },
};

export default nextConfig;
