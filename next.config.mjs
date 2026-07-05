/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // unavatar (X pfps) is fetched as <img> on a canvas; allow the host for next/image too if we adopt it
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'unavatar.io' }],
  },
  webpack: (config) => {
    config.externals = config.externals || [];
    config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    // Optional peer deps the @privy-io/react-auth SDK references but that we don't use — stub them
    // so the bundler doesn't warn about the unresolved optional imports.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@farcaster/mini-app-solana": false,
      "@stripe/crypto": false,
    };
    return config;
  },
};

export default nextConfig;
