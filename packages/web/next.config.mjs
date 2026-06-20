/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace types are consumed directly from source.
  transpilePackages: ['@velvet-comet/contracts'],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
